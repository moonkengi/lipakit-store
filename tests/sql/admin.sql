-- =============================================================================
-- Database tests for admin money actions, payouts and revenue.
--   DATABASE_URL=... pnpm test:sql   (rolled back)
-- =============================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'admin-test@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'customer-test@example.com');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000e1';
insert into public.plans (id, code, name, price_kes, interval) values
  ('00000000-0000-0000-0000-0000000000f1', 'adm_month', 'Adm Monthly', 1200, 'month'),
  ('00000000-0000-0000-0000-0000000000f2', 'adm_year', 'Adm Yearly', 12000, 'year');

do $$
declare
  v_order uuid;
  v_tx    uuid;
  v_rev   record;
  r       text;
begin
  -- 1. An unmatched Paybill payment, assigned by an admin, pays the order and starts the subscription.
  insert into public.orders (id, user_id, purpose, amount_kes, account_ref, plan_id)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e2', 'subscription', 1200, 'LKADM001',
          '00000000-0000-0000-0000-0000000000f1')
  returning id into v_order;
  perform public.mpesa_settle_c2b('ADMTRANS01', 1200, 'TYPO', '254712345678', now(), '{}');
  select id into v_tx from public.mpesa_transactions where mpesa_receipt = 'ADMTRANS01';
  assert (select status from public.mpesa_transactions where id = v_tx) = 'unmatched';

  r := public.admin_assign_c2b(v_tx, v_order, '00000000-0000-0000-0000-0000000000e1');
  assert r = 'assigned';
  assert (select status from public.orders where id = v_order) = 'paid';
  assert exists (select 1 from public.receipts where order_id = v_order), 'receipt issued';
  assert exists (select 1 from public.subscriptions where user_id = '00000000-0000-0000-0000-0000000000e2' and status = 'active');
  assert exists (select 1 from public.admin_audit_log where action = 'assign_c2b' and target_id = v_order), 'audited';

  -- 2. It can't be assigned twice.
  begin
    perform public.admin_assign_c2b(v_tx, v_order, '00000000-0000-0000-0000-0000000000e1');
    raise exception 'double assignment must fail';
  exception when raise_exception then
    if sqlerrm = 'double assignment must fail' then raise; end if;
  end;

  -- 3. Review: approve grants access; reject doesn't, and needs a note.
  insert into public.orders (id, user_id, purpose, amount_kes, account_ref, plan_id, status, paid_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e2', 'one_off', 500, 'LKADM002', null, 'needs_review', now())
  returning id into v_order;
  begin
    perform public.admin_resolve_review(v_order, true, '00000000-0000-0000-0000-0000000000e1', '  ');
    raise exception 'empty note must fail';
  exception when raise_exception then
    if sqlerrm = 'empty note must fail' then raise; end if;
  end;
  r := public.admin_resolve_review(v_order, false, '00000000-0000-0000-0000-0000000000e1', 'Refunded by B2C');
  assert r = 'rejected' and (select status from public.orders where id = v_order) = 'failed';
  assert not exists (select 1 from public.receipts where order_id = v_order), 'no receipt when rejected';

  insert into public.orders (id, user_id, purpose, amount_kes, account_ref, status, paid_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e2', 'one_off', 700, 'LKADM003', 'needs_review', now())
  returning id into v_order;
  r := public.admin_resolve_review(v_order, true, '00000000-0000-0000-0000-0000000000e1', 'Customer confirmed');
  assert r = 'approved' and exists (select 1 from public.receipts where order_id = v_order);

  -- 4. Payouts: the idempotency key blocks a double send.
  insert into public.payouts (phone, amount_kes, reason, idempotency_key) values ('254712345678', 100, 'refund', 'key-1');
  begin
    insert into public.payouts (phone, amount_kes, reason, idempotency_key) values ('254712345678', 100, 'refund', 'key-1');
    raise exception 'duplicate idempotency key must fail';
  exception when unique_violation then null;
  end;

  -- 5. Revenue: today includes the payments above; MRR counts the active monthly plan.
  select * into v_rev from public.admin_revenue_summary();
  assert v_rev.today_kes >= 1200 + 700, format('today %s', v_rev.today_kes);
  assert v_rev.mrr_kes >= 1200, format('mrr %s', v_rev.mrr_kes);
  assert v_rev.active_subscriptions >= 1;
end;
$$;

-- Signed-in users can't run admin functions directly, even admins (the app calls them with the service role).
set local role authenticated;
do $$
begin
  perform public.admin_revenue_summary();
  raise exception 'authenticated must not run admin functions';
exception when insufficient_privilege then null;
end;
$$;
reset role;

select 'admin: all assertions passed' as result;
rollback;
