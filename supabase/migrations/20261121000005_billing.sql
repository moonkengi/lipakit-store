-- =============================================================================
-- Billing: subscriptions follow paid orders, receipts, C2B settlement, Ratiba.
--
-- One rule holds everywhere: "order becomes paid" → "receipt exists" and
-- "subscription is activated or extended" happen in the SAME transaction,
-- inside billing_apply_paid_order(). Every settle path (STK, C2B, Ratiba)
-- calls it, so there is exactly one place that grants access for money.
-- =============================================================================

-- --- Subscriptions: renewal method and Ratiba standing order ------------------
alter table public.subscriptions
  add column renewal_method text not null default 'manual' check (renewal_method in ('manual', 'ratiba')),
  -- AccountReference on the customer's standing order; how Ratiba payments find this subscription.
  add column ratiba_account_ref text unique
    check (ratiba_account_ref is null or char_length(ratiba_account_ref) between 4 and 12),
  add column ratiba_status text
    check (ratiba_status is null or ratiba_status in ('requested', 'active', 'failed', 'cancelled'));

-- --- Transactions and callbacks: new kinds and C2B fields ---------------------
alter table public.mpesa_transactions drop constraint mpesa_transactions_kind_check;
alter table public.mpesa_transactions
  add constraint mpesa_transactions_kind_check check (kind in ('stk', 'c2b', 'b2c', 'ratiba')),
  -- C2B: the account number the customer typed (BillRefNumber), kept for the unmatched queue.
  add column account_ref text,
  -- C2B: when M-Pesa says the payment happened (TransTime).
  add column transaction_time timestamptz;

create index mpesa_transactions_c2b_ref_idx on public.mpesa_transactions (account_ref) where kind = 'c2b';

alter table public.mpesa_callbacks drop constraint mpesa_callbacks_kind_check;
alter table public.mpesa_callbacks
  add constraint mpesa_callbacks_kind_check
  check (kind in ('stk', 'c2b_validate', 'c2b_confirm', 'b2c_result', 'b2c_timeout', 'ratiba'));

-- --- Receipt numbers: PREFIX-YEAR-000123, gap-free per paid order --------------
create sequence public.receipt_number_seq;
revoke all on sequence public.receipt_number_seq from public, anon, authenticated;

create or replace function public.next_receipt_number(p_prefix text)
returns text
language sql
volatile
set search_path = ''
as $$
  select p_prefix || '-' || to_char(now() at time zone 'Africa/Nairobi', 'YYYY') || '-'
         || lpad(nextval('public.receipt_number_seq')::text, 6, '0');
$$;

-- --- The one place money turns into access ------------------------------------
create or replace function public.billing_apply_paid_order(p_order_id uuid, p_receipt_prefix text default 'LK')
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_sub   public.subscriptions%rowtype;
  v_plan  public.plans%rowtype;
  v_step  interval;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'paid' then
    return;
  end if;

  -- Receipt: one per paid order. Checked first so a re-run never burns a number.
  if not exists (select 1 from public.receipts where order_id = v_order.id) then
    insert into public.receipts (order_id, number)
    values (v_order.id, public.next_receipt_number(p_receipt_prefix));
  end if;

  if v_order.purpose not in ('subscription', 'renewal') then
    return;
  end if;

  -- Which subscription? The one on the order if it's still live, else the user's live one.
  if v_order.subscription_id is not null then
    select * into v_sub from public.subscriptions where id = v_order.subscription_id for update;
  end if;
  if v_sub.id is null or v_sub.status not in ('trialing', 'active', 'grace') then
    select * into v_sub from public.subscriptions
    where user_id = v_order.user_id and status in ('trialing', 'active', 'grace')
    for update;
  end if;

  select * into v_plan from public.plans where id = coalesce(v_order.plan_id, v_sub.plan_id);
  if v_plan.id is null then
    raise exception 'order % is a % order but has no plan', v_order.id, v_order.purpose;
  end if;
  v_step := case v_plan.interval
              when 'month'   then interval '1 month'
              when 'quarter' then interval '3 months'
              else                interval '1 year'
            end;

  if v_sub.id is not null then
    -- Extend from the OLD period end, not the payment date: paying early never
    -- loses days, and paying during grace doesn't gift the grace days.
    -- A plan change on the order takes effect here (see docs/04-billing.md).
    update public.subscriptions
    set status               = 'active',
        plan_id              = v_plan.id,
        current_period_start = v_sub.current_period_end,
        current_period_end   = v_sub.current_period_end + v_step,
        grace_until          = null,
        cancel_at_period_end = false
    where id = v_sub.id;
  else
    insert into public.subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
    values (v_order.user_id, v_plan.id, 'active', now(), now() + v_step)
    returning * into v_sub;
  end if;

  update public.orders set subscription_id = v_sub.id
  where id = v_order.id and subscription_id is distinct from v_sub.id;

  -- Other unpaid renewal bills for this subscription are now moot. Leave any
  -- with an STK push still in flight; they settle (and extend) on their own.
  update public.orders o
  set status = 'cancelled', status_reason = 'Superseded: renewed by payment ' || v_order.account_ref
  where o.subscription_id = v_sub.id
    and o.purpose = 'renewal'
    and o.status = 'pending'
    and o.id <> v_order.id
    and not exists (
      select 1 from public.mpesa_transactions t where t.order_id = o.id and t.status = 'pending'
    );
end;
$$;

-- --- STK settlement, v2: also applies billing, and tolerates C2B getting there first
-- (A Paybill with C2B URLs registered also sends a C2B confirmation for STK payments,
-- with TransID equal to the STK receipt. Whichever arrives first settles the order.)
drop function public.mpesa_settle_stk(text, text, text, text, integer, text, text, text, jsonb);

create or replace function public.mpesa_settle_stk(
  p_checkout_request_id text,
  p_tx_status           text,
  p_order_status        text,
  p_order_reason        text,
  p_result_code         integer default null,
  p_result_desc         text    default null,
  p_receipt             text    default null,
  p_phone               text    default null,
  p_raw                 jsonb   default null,
  p_receipt_prefix      text    default 'LK'
)
returns text   -- 'settled' | 'noop' | 'receipt_added'
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tx      public.mpesa_transactions%rowtype;
  v_receipt text;
  v_rows    integer;
begin
  select * into v_tx
  from public.mpesa_transactions
  where checkout_request_id = p_checkout_request_id and kind = 'stk'
  for update;

  if not found then
    raise exception 'unknown checkout_request_id %', p_checkout_request_id using errcode = 'no_data_found';
  end if;

  -- Don't store a receipt number some other row (a C2B confirmation) already holds.
  v_receipt := case
                 when p_receipt is null then null
                 when exists (select 1 from public.mpesa_transactions
                              where mpesa_receipt = p_receipt and id <> v_tx.id) then null
                 else p_receipt
               end;

  if v_tx.status <> 'pending' then
    if v_tx.status = 'success' and v_tx.mpesa_receipt is null and v_receipt is not null then
      update public.mpesa_transactions set mpesa_receipt = v_receipt where id = v_tx.id;
      return 'receipt_added';
    end if;
    return 'noop';
  end if;

  update public.mpesa_transactions
  set status        = p_tx_status,
      result_code   = p_result_code,
      result_desc   = p_result_desc,
      mpesa_receipt = coalesce(v_receipt, mpesa_receipt),
      phone         = coalesce(p_phone, phone),
      raw           = coalesce(p_raw, raw)
  where id = v_tx.id;

  update public.orders
  set status        = p_order_status,
      status_reason = p_order_reason,
      paid_at       = case when p_order_status in ('paid', 'needs_review') then now() else paid_at end
  where id = v_tx.order_id and status = 'pending';
  get diagnostics v_rows = row_count;

  if v_rows > 0 and p_order_status = 'paid' then
    perform public.billing_apply_paid_order(v_tx.order_id, p_receipt_prefix);
  end if;

  return 'settled';
end;
$$;

-- --- C2B settlement (Paybill/Till payments, including Ratiba executions) -------
-- The matching decision (which order, paid or needs_review) is made in
-- TypeScript (src/lib/reconcile/c2b.ts). This applies it atomically. TransID
-- is unique, so a repeated confirmation is a no-op.
create or replace function public.mpesa_settle_c2b(
  p_trans_id        text,
  p_amount          integer,
  p_account_ref     text,
  p_phone           text,
  p_trans_time      timestamptz,
  p_raw             jsonb,
  p_order_id        uuid default null,   -- matched order, if any
  p_subscription_id uuid default null,   -- matched Ratiba subscription, if any (an order is created)
  p_order_status    text default null,   -- 'paid' | 'needs_review' when matched
  p_order_reason    text default null,
  p_receipt_prefix  text default 'LK'
)
returns text   -- 'settled' | 'needs_review' | 'unmatched' | 'duplicate' | 'noop'
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id uuid := p_order_id;
  v_created  boolean := false;
  v_sub      public.subscriptions%rowtype;
  v_plan     public.plans%rowtype;
  v_tx_id    uuid;
  v_rows     integer;
begin
  if exists (select 1 from public.mpesa_transactions where mpesa_receipt = p_trans_id) then
    return 'noop';
  end if;

  -- A Ratiba execution: create the renewal order it pays for.
  if v_order_id is null and p_subscription_id is not null then
    select * into v_sub from public.subscriptions where id = p_subscription_id;
    select * into v_plan from public.plans where id = v_sub.plan_id;
    if v_sub.id is not null then
      insert into public.orders (user_id, subscription_id, plan_id, purpose, amount_kes, account_ref)
      values (
        v_sub.user_id, v_sub.id, v_sub.plan_id, 'renewal', coalesce(v_plan.price_kes, p_amount),
        left(p_receipt_prefix || 'R' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 9)), 12)
      )
      returning id into v_order_id;
      v_created := true;
    end if;
  end if;

  insert into public.mpesa_transactions
    (order_id, kind, mpesa_receipt, phone, amount_kes, status, account_ref, transaction_time, raw, result_code, result_desc)
  values
    (v_order_id, 'c2b', p_trans_id, p_phone, p_amount,
     case when v_order_id is null then 'unmatched' else 'success' end,
     p_account_ref, p_trans_time, p_raw, 0, 'C2B confirmation')
  on conflict (mpesa_receipt) do nothing
  returning id into v_tx_id;

  if v_tx_id is null then
    -- Lost a race with an identical confirmation.
    if v_created then delete from public.orders where id = v_order_id; end if;
    return 'noop';
  end if;

  if v_order_id is null then
    return 'unmatched';
  end if;

  -- A late Paybill payment may pay an order whose STK attempt expired or failed.
  update public.orders
  set status = p_order_status, status_reason = p_order_reason, paid_at = now()
  where id = v_order_id and status in ('pending', 'expired', 'failed', 'cancelled');
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    -- Already paid: this is money on top. Put it in the unmatched queue for a human.
    update public.mpesa_transactions
    set status = 'unmatched', result_desc = 'Order was already paid: possible double payment'
    where id = v_tx_id;
    return 'duplicate';
  end if;

  if p_order_status = 'paid' then
    perform public.billing_apply_paid_order(v_order_id, p_receipt_prefix);
    return 'settled';
  end if;
  return 'needs_review';
end;
$$;

-- Server-side only, like every money-moving function.
revoke all on function public.next_receipt_number(text) from public, anon, authenticated;
revoke all on function public.billing_apply_paid_order(uuid, text) from public, anon, authenticated;
revoke all on function public.mpesa_settle_stk(text, text, text, text, integer, text, text, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.mpesa_settle_c2b(text, integer, text, text, timestamptz, jsonb, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.next_receipt_number(text) to service_role;
grant execute on function public.billing_apply_paid_order(uuid, text) to service_role;
grant execute on function public.mpesa_settle_stk(text, text, text, text, integer, text, text, text, jsonb, text) to service_role;
grant execute on function public.mpesa_settle_c2b(text, integer, text, text, timestamptz, jsonb, uuid, uuid, text, text, text)
  to service_role;

-- --- Receipt PDFs: private bucket, served only through signed URLs -------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
    on conflict (id) do nothing;
  end if;
end;
$$;

-- --- Scheduled jobs: add the daily renewals run ----------------------------------
create or replace function public.lipakit_schedule_jobs(p_app_url text, p_cron_secret text)
returns setof text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_url text := rtrim(p_app_url, '/');
  v_job_sql text;
begin
  if v_url !~ '^https://' then
    raise exception 'p_app_url must be your public https:// URL, e.g. https://your-app.vercel.app';
  end if;
  if char_length(p_cron_secret) < 16 then
    raise exception 'p_cron_secret must be the CRON_SECRET from your app environment (16+ characters)';
  end if;

  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;

  delete from vault.secrets where name in ('lipakit_app_url', 'lipakit_cron_secret');
  perform vault.create_secret(v_url, 'lipakit_app_url');
  perform vault.create_secret(p_cron_secret, 'lipakit_cron_secret');

  -- Same request shape for every job; only the path differs.
  v_job_sql := $tpl$
    select net.http_get(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'lipakit_app_url') || '%s',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lipakit_cron_secret')
      ),
      timeout_milliseconds := 55000
    );
  $tpl$;

  -- M-Pesa status poller (also sends pending receipts): every minute.
  perform cron.schedule('lipakit-mpesa-poll', '* * * * *', format(v_job_sql, '/api/cron/mpesa-poll'));
  return next 'lipakit-mpesa-poll';

  -- Renewal reminders, grace and expiry: daily at 06:00 Nairobi time (03:00 UTC).
  perform cron.schedule('lipakit-renewals', '0 3 * * *', format(v_job_sql, '/api/cron/renewals'));
  return next 'lipakit-renewals';
end;
$$;

revoke all on function public.lipakit_schedule_jobs(text, text) from public, anon, authenticated;
