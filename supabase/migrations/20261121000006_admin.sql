-- =============================================================================
-- M4: admin tools, payouts, notification channels, job history.
--
-- Admin money actions (assigning an unmatched payment, resolving a review)
-- are Postgres functions so they're atomic, go through the same
-- billing_apply_paid_order() as every payment, and always write an audit entry.
-- =============================================================================

-- --- Audit log: every admin action that touches money or access -------------
create table public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  admin_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  target_type text not null,
  target_id   uuid,
  details     jsonb not null default '{}'::jsonb
);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

-- --- B2C payouts (money out to M-Pesa) ---------------------------------------
create table public.payouts (
  id                         uuid primary key default gen_random_uuid(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  requested_by               uuid references public.profiles (id) on delete set null,
  user_id                    uuid references public.profiles (id) on delete set null,
  phone                      text not null check (phone ~ '^254[17][0-9]{8}$'),
  amount_kes                 integer not null check (amount_kes > 0),
  reason                     text not null,
  command_id                 text not null default 'BusinessPayment'
                             check (command_id in ('BusinessPayment', 'SalaryPayment', 'PromotionPayment')),
  -- Set by the admin form, so a double click or a retried request can't send money twice.
  idempotency_key            text not null unique,
  status                     text not null default 'pending'
                             check (status in ('pending', 'success', 'failed', 'timeout')),
  conversation_id            text unique,
  originator_conversation_id text unique,
  mpesa_receipt              text unique,
  result_code                integer,
  result_desc                text,
  receiver_name              text,
  raw                        jsonb
);
create index payouts_created_idx on public.payouts (created_at desc);
create trigger payouts_set_updated_at before update on public.payouts
  for each row execute function public.set_updated_at();

-- --- Telegram account linking ---------------------------------------------------
create table public.telegram_link_codes (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- sha256 of the code; the code itself is only ever shown to the user.
  code_hash  text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz
);

-- --- Web push subscriptions ---------------------------------------------------------
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- --- Scheduled job history (for the Health page) -------------------------------------
create table public.job_runs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  job         text not null,
  ok          boolean not null,
  duration_ms integer not null,
  summary     jsonb
);
create index job_runs_job_idx on public.job_runs (job, created_at desc);

-- --- RLS ----------------------------------------------------------------------------
alter table public.admin_audit_log     enable row level security;
alter table public.payouts             enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.job_runs            enable row level security;

create policy "admin_audit_log: admin reads" on public.admin_audit_log
  for select to authenticated using ((select public.is_admin()));
create policy "payouts: admin reads" on public.payouts
  for select to authenticated using ((select public.is_admin()));
create policy "job_runs: admin reads" on public.job_runs
  for select to authenticated using ((select public.is_admin()));
create policy "push_subscriptions: read own" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
-- telegram_link_codes: no policies; server-only.

-- --- Admin: assign an unmatched C2B payment to an order -------------------------------
create or replace function public.admin_assign_c2b(
  p_tx_id          uuid,
  p_order_id       uuid,
  p_admin_id       uuid,
  p_receipt_prefix text default 'LK'
)
returns text  -- 'assigned'
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tx    public.mpesa_transactions%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_tx from public.mpesa_transactions where id = p_tx_id for update;
  if not found or v_tx.kind <> 'c2b' or v_tx.status <> 'unmatched' then
    raise exception 'transaction % is not an unmatched C2B payment', p_tx_id;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_order.status in ('paid', 'needs_review') then
    raise exception 'order % is already %', v_order.account_ref, v_order.status;
  end if;

  update public.mpesa_transactions
  set order_id = v_order.id, status = 'success', result_desc = 'Assigned by admin'
  where id = v_tx.id;

  -- The admin decided this payment covers the order, even if the amount differs; the audit log records both.
  update public.orders
  set status = 'paid', paid_at = now(),
      status_reason = format('Assigned by admin from M-Pesa %s (KES %s)', v_tx.mpesa_receipt, v_tx.amount_kes)
  where id = v_order.id;

  perform public.billing_apply_paid_order(v_order.id, p_receipt_prefix);

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
  values (p_admin_id, 'assign_c2b', 'order', v_order.id, jsonb_build_object(
    'transaction_id', v_tx.id, 'mpesa_receipt', v_tx.mpesa_receipt,
    'paid_kes', v_tx.amount_kes, 'order_kes', v_order.amount_kes, 'account_ref', v_order.account_ref));
  return 'assigned';
end;
$$;

-- --- Admin: resolve a needs_review order ----------------------------------------------
create or replace function public.admin_resolve_review(
  p_order_id       uuid,
  p_approve        boolean,
  p_admin_id       uuid,
  p_note           text,
  p_receipt_prefix text default 'LK'
)
returns text  -- 'approved' | 'rejected'
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'needs_review' then
    raise exception 'order % is not waiting for review', p_order_id;
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'a note is required';
  end if;

  if p_approve then
    update public.orders set status = 'paid', paid_at = coalesce(paid_at, now()),
      status_reason = 'Approved by admin: ' || p_note
    where id = v_order.id;
    perform public.billing_apply_paid_order(v_order.id, p_receipt_prefix);
  else
    -- Rejected: no access is granted. Any money received must be refunded outside the app (e.g. a B2C payout).
    update public.orders set status = 'failed', paid_at = null,
      status_reason = 'Rejected by admin: ' || p_note
    where id = v_order.id;
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
  values (p_admin_id, case when p_approve then 'approve_review' else 'reject_review' end,
          'order', v_order.id, jsonb_build_object('note', p_note, 'previous_reason', v_order.status_reason));
  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;

-- --- Revenue for the admin overview -------------------------------------------------------
-- Today and this month in Nairobi time; MRR = live paid subscriptions, normalised to a month.
create or replace function public.admin_revenue_summary()
returns table (today_kes bigint, month_kes bigint, mrr_kes bigint, active_subscriptions bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      (date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi') as day_start,
      (date_trunc('month', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi') as month_start
  )
  select
    (select coalesce(sum(o.amount_kes), 0) from public.orders o, bounds b where o.status = 'paid' and o.paid_at >= b.day_start),
    (select coalesce(sum(o.amount_kes), 0) from public.orders o, bounds b where o.status = 'paid' and o.paid_at >= b.month_start),
    (select coalesce(round(sum(case p.interval when 'month' then p.price_kes when 'quarter' then p.price_kes / 3.0
                                               else p.price_kes / 12.0 end)), 0)::bigint
       from public.subscriptions s join public.plans p on p.id = s.plan_id
      where s.status in ('active', 'grace')),
    (select count(*) from public.subscriptions s where s.status in ('active', 'grace'));
$$;

revoke all on function public.admin_assign_c2b(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_resolve_review(uuid, boolean, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_revenue_summary() from public, anon, authenticated;
grant execute on function public.admin_assign_c2b(uuid, uuid, uuid, text) to service_role;
grant execute on function public.admin_resolve_review(uuid, boolean, uuid, text, text) to service_role;
grant execute on function public.admin_revenue_summary() to service_role;
