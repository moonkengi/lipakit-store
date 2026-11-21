-- =============================================================================
-- Database tests for billing: paid orders → receipts + subscription changes,
-- C2B settlement, Ratiba executions, and the STK/C2B race.
--
--   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:sql
-- Runs in a transaction that is rolled back.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

-- Fixtures: one user, a monthly and a yearly plan.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'billing-test@example.com');
insert into public.plans (id, code, name, price_kes, interval) values
  ('00000000-0000-0000-0000-0000000000d1', 'test_month', 'Test Monthly', 1000, 'month'),
  ('00000000-0000-0000-0000-0000000000d2', 'test_year', 'Test Yearly', 10000, 'year');

-- Helper: a pending STK order + transaction.
create function pg_temp.stk_order(p_ref text, p_purpose text, p_amount int, p_plan uuid, p_sub uuid default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.orders (user_id, purpose, amount_kes, account_ref, plan_id, subscription_id)
  values ('00000000-0000-0000-0000-0000000000c1', p_purpose, p_amount, p_ref, p_plan, p_sub)
  returning id into v_id;
  insert into public.mpesa_transactions (order_id, kind, checkout_request_id, amount_kes)
  values (v_id, 'stk', 'ws_' || p_ref, p_amount);
  return v_id;
end $$;

do $$
declare
  v_sub   public.subscriptions%rowtype;
  v_end   timestamptz;
  v_order uuid;
  v_bill  uuid;
  r       text;
begin
  -- 1. First payment: receipt + new active monthly subscription starting now.
  v_order := pg_temp.stk_order('LKBILL01', 'subscription', 1000, '00000000-0000-0000-0000-0000000000d1');
  r := public.mpesa_settle_stk('ws_LKBILL01', 'success', 'paid', 'ok', 0, 'ok', 'RCPTB00001', null, null, 'LK');
  assert r = 'settled';
  assert (select number from public.receipts where order_id = v_order) ~ '^LK-\d{4}-\d{6}$', 'receipt number format';
  select * into v_sub from public.subscriptions where user_id = '00000000-0000-0000-0000-0000000000c1';
  assert v_sub.status = 'active', 'new subscription is active';
  assert v_sub.current_period_end = v_sub.current_period_start + interval '1 month', 'one month period';
  assert (select subscription_id from public.orders where id = v_order) = v_sub.id, 'order linked to subscription';

  -- 2. Renewal bill + an early STK renewal: extends from the OLD end, and supersedes the bill.
  v_end := v_sub.current_period_end;
  insert into public.orders (user_id, subscription_id, plan_id, purpose, amount_kes, account_ref)
  values ('00000000-0000-0000-0000-0000000000c1', v_sub.id, v_sub.plan_id, 'renewal', 1000, 'LKBILL02')
  returning id into v_bill;
  v_order := pg_temp.stk_order('LKBILL03', 'renewal', 1000, v_sub.plan_id, v_sub.id);
  perform public.mpesa_settle_stk('ws_LKBILL03', 'success', 'paid', 'ok', 0, 'ok', 'RCPTB00003');
  select * into v_sub from public.subscriptions where id = v_sub.id;
  assert v_sub.current_period_start = v_end and v_sub.current_period_end = v_end + interval '1 month',
    'renewal extends from the old period end';
  assert (select status from public.orders where id = v_bill) = 'cancelled', 'the unpaid bill is superseded';

  -- 3. Grace: paying extends from the old (past) end, and clears grace.
  update public.subscriptions
  set status = 'grace', current_period_start = now() - interval '33 days', current_period_end = now() - interval '2 days',
      grace_until = now() + interval '1 day'
  where id = v_sub.id;
  v_order := pg_temp.stk_order('LKBILL04', 'renewal', 1000, v_sub.plan_id, v_sub.id);
  perform public.mpesa_settle_stk('ws_LKBILL04', 'success', 'paid', 'ok', 0, 'ok', 'RCPTB00004');
  select * into v_sub from public.subscriptions where id = v_sub.id;
  assert v_sub.status = 'active' and v_sub.grace_until is null, 'grace payment reactivates';
  assert v_sub.current_period_end::date = (now() - interval '2 days' + interval '1 month')::date, 'grace days are not gifted';

  -- 4. Plan change on a renewal order switches the plan for the new period.
  v_order := pg_temp.stk_order('LKBILL05', 'renewal', 10000, '00000000-0000-0000-0000-0000000000d2', v_sub.id);
  v_end := v_sub.current_period_end;
  perform public.mpesa_settle_stk('ws_LKBILL05', 'success', 'paid', 'ok', 0, 'ok', 'RCPTB00005');
  select * into v_sub from public.subscriptions where id = v_sub.id;
  assert v_sub.plan_id = '00000000-0000-0000-0000-0000000000d2' and v_sub.current_period_end = v_end + interval '1 year',
    'yearly plan applied from the next period';

  -- 5. A failed payment changes nothing and issues no receipt.
  v_order := pg_temp.stk_order('LKBILL06', 'renewal', 10000, v_sub.plan_id, v_sub.id);
  perform public.mpesa_settle_stk('ws_LKBILL06', 'cancelled', 'cancelled', 'cancelled', 1032, 'cancelled');
  assert not exists (select 1 from public.receipts where order_id = v_order), 'no receipt for a cancelled payment';
  assert (select current_period_end from public.subscriptions where id = v_sub.id) = v_end + interval '1 year';

  -- 6. Expired subscription: a new payment starts a fresh subscription from now.
  update public.subscriptions set status = 'expired' where id = v_sub.id;
  v_order := pg_temp.stk_order('LKBILL07', 'subscription', 1000, '00000000-0000-0000-0000-0000000000d1');
  perform public.mpesa_settle_stk('ws_LKBILL07', 'success', 'paid', 'ok', 0, 'ok', 'RCPTB00007');
  assert (select count(*) from public.subscriptions where user_id = '00000000-0000-0000-0000-0000000000c1') = 2,
    'a second subscription row is created';
  select * into v_sub from public.subscriptions
  where user_id = '00000000-0000-0000-0000-0000000000c1' and status = 'active';
  assert v_sub.current_period_start > now() - interval '1 minute', 'fresh subscription starts now';

  -- 7. C2B pays an order by account number.
  insert into public.orders (user_id, subscription_id, plan_id, purpose, amount_kes, account_ref)
  values ('00000000-0000-0000-0000-0000000000c1', v_sub.id, v_sub.plan_id, 'renewal', 1000, 'LKBILL08')
  returning id into v_bill;
  v_end := v_sub.current_period_end;
  r := public.mpesa_settle_c2b('TRANSC2B01', 1000, 'LKBILL08', '254712345678', now(), '{}', v_bill, null, 'paid', 'ok');
  assert r = 'settled', format('c2b settle: %s', r);
  assert (select current_period_end from public.subscriptions where id = v_sub.id) = v_end + interval '1 month';

  -- 8. The same confirmation again is a no-op.
  r := public.mpesa_settle_c2b('TRANSC2B01', 1000, 'LKBILL08', '254712345678', now(), '{}', v_bill, null, 'paid', 'ok');
  assert r = 'noop', format('repeat c2b: %s', r);
  assert (select current_period_end from public.subscriptions where id = v_sub.id) = v_end + interval '1 month',
    'no double extension';

  -- 9. Paying an already-paid order: money lands in the unmatched queue.
  r := public.mpesa_settle_c2b('TRANSC2B02', 1000, 'LKBILL08', '254712345678', now(), '{}', v_bill, null, 'paid', 'ok');
  assert r = 'duplicate';
  assert (select status from public.mpesa_transactions where mpesa_receipt = 'TRANSC2B02') = 'unmatched';

  -- 10. No match at all.
  r := public.mpesa_settle_c2b('TRANSC2B03', 500, 'WHOKNOWS', '254700000000', now(), '{}');
  assert r = 'unmatched';
  assert (select account_ref from public.mpesa_transactions where mpesa_receipt = 'TRANSC2B03') = 'WHOKNOWS';

  -- 11. Race: the C2B confirmation of an STK payment arrives BEFORE the STK settle.
  select * into v_sub from public.subscriptions where id = v_sub.id;
  v_end := v_sub.current_period_end;
  v_order := pg_temp.stk_order('LKBILL09', 'renewal', 1000, v_sub.plan_id, v_sub.id);
  r := public.mpesa_settle_c2b('RCPTRACE01', 1000, 'LKBILL09', '254712345678', now(), '{}', v_order, null, 'paid', 'ok');
  assert r = 'settled';
  r := public.mpesa_settle_stk('ws_LKBILL09', 'success', 'paid', 'ok', 0, 'ok', 'RCPTRACE01');
  assert r = 'settled', 'STK settles its own transaction without a unique-key error';
  assert (select current_period_end from public.subscriptions where id = v_sub.id) = v_end + interval '1 month',
    'extended exactly once';
  assert (select count(*) from public.receipts where order_id = v_order) = 1, 'one receipt';

  -- 12. Ratiba execution: matched by the subscription's standing-order reference.
  update public.subscriptions set renewal_method = 'ratiba', ratiba_account_ref = 'LKRATIBA01' where id = v_sub.id;
  v_end := (select current_period_end from public.subscriptions where id = v_sub.id);
  r := public.mpesa_settle_c2b('RATIBA0001', 1000, 'LKRATIBA01', null, now(), '{}', null, v_sub.id, 'paid', 'ok');
  assert r = 'settled', format('ratiba: %s', r);
  assert (select current_period_end from public.subscriptions where id = v_sub.id) = v_end + interval '1 month';
  assert exists (
    select 1 from public.orders o join public.mpesa_transactions t on t.order_id = o.id
    where t.mpesa_receipt = 'RATIBA0001' and o.purpose = 'renewal' and o.status = 'paid'
  ), 'a renewal order was created for the Ratiba payment';

  -- 13. Receipt numbers are sequential and never reused.
  assert (select count(distinct number) from public.receipts) = (select count(*) from public.receipts);
end;
$$;

-- Signed-in users can't call any of it.
set local role authenticated;
do $$
begin
  begin
    perform public.billing_apply_paid_order(gen_random_uuid());
    raise exception 'authenticated must not run billing_apply_paid_order';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.mpesa_settle_c2b('X', 1, 'X', null, now(), '{}');
    raise exception 'authenticated must not run mpesa_settle_c2b';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Products: a one-time product order gets a receipt and never touches subscriptions.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c9', 'product-test@example.com');
insert into public.products (id, code, name, price_kes) values
  ('00000000-0000-0000-0000-0000000000e1', 'test_ebook', 'Test E-book', 500);
do $$
declare v_order uuid;
begin
  insert into public.orders (user_id, purpose, amount_kes, account_ref, product_id)
  values ('00000000-0000-0000-0000-0000000000c9', 'one_off', 500, 'LKPROD01', '00000000-0000-0000-0000-0000000000e1')
  returning id into v_order;
  insert into public.mpesa_transactions (order_id, kind, checkout_request_id, amount_kes)
  values (v_order, 'stk', 'ws_LKPROD01', 500);
  assert public.mpesa_settle_stk('ws_LKPROD01', 'success', 'paid', 'ok', 0, 'ok', 'RCPTP00001') = 'settled';
  assert (select status from public.orders where id = v_order) = 'paid', 'product order paid';
  assert exists (select 1 from public.receipts where order_id = v_order), 'product order has a receipt';
  assert not exists (select 1 from public.subscriptions where user_id = '00000000-0000-0000-0000-0000000000c9'),
    'a product purchase creates no subscription';

  begin
    insert into public.orders (user_id, purpose, amount_kes, account_ref, product_id)
    values ('00000000-0000-0000-0000-0000000000c9', 'subscription', 500, 'LKPROD02', '00000000-0000-0000-0000-0000000000e1');
    raise exception 'a product order must be one_off';
  exception when check_violation then null;
  end;
end $$;

select 'billing: all assertions passed' as result;
rollback;
