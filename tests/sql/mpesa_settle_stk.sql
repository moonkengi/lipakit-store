-- =============================================================================
-- Database tests for mpesa_settle_stk(): atomic, idempotent settlement and
-- that ordinary users can't call it.
--
-- Run against a local Supabase (supabase start):
--   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:sql
-- Everything runs in a transaction that is rolled back, so no data is left behind.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'sql-test@example.com');

insert into public.orders (id, user_id, purpose, amount_kes, account_ref) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000a1', 'one_off', 1500, 'LKSQLT01'),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-0000000000a1', 'one_off', 1500, 'LKSQLT02');
insert into public.mpesa_transactions (order_id, kind, checkout_request_id, amount_kes) values
  ('00000000-0000-0000-0000-00000000b001', 'stk', 'ws_sql_1', 1500),
  ('00000000-0000-0000-0000-00000000b002', 'stk', 'ws_sql_2', 1500);

do $$
declare r text;
begin
  -- First settlement wins.
  r := public.mpesa_settle_stk('ws_sql_1', 'success', 'paid', 'ok', 0, 'ok', null, '254712345678', '{}');
  assert r = 'settled', format('first settle: expected settled, got %s', r);
  assert (select status from public.orders where account_ref = 'LKSQLT01') = 'paid', 'order should be paid';
  assert (select paid_at from public.orders where account_ref = 'LKSQLT01') is not null, 'paid_at should be set';

  -- A second, contradictory settlement is ignored.
  r := public.mpesa_settle_stk('ws_sql_1', 'cancelled', 'cancelled', 'nope', 1032);
  assert r = 'noop', format('second settle: expected noop, got %s', r);
  assert (select status from public.orders where account_ref = 'LKSQLT01') = 'paid', 'order must stay paid';

  -- A late callback may add the missing receipt, once.
  r := public.mpesa_settle_stk('ws_sql_1', 'success', 'paid', '', 0, '', 'RCPT000001');
  assert r = 'receipt_added', format('late receipt: expected receipt_added, got %s', r);
  r := public.mpesa_settle_stk('ws_sql_1', 'success', 'paid', '', 0, '', 'RCPT000002');
  assert r = 'noop', 'receipt must not be overwritten';
  assert (select mpesa_receipt from public.mpesa_transactions where checkout_request_id = 'ws_sql_1') = 'RCPT000001';

  -- needs_review keeps the money trail (paid_at) for the admin.
  r := public.mpesa_settle_stk('ws_sql_2', 'success', 'needs_review', 'Amount mismatch', 0);
  assert (select status from public.orders where account_ref = 'LKSQLT02') = 'needs_review';

  -- Unknown IDs are an error, not a silent no-op.
  begin
    perform public.mpesa_settle_stk('ws_sql_missing', 'success', 'paid', '');
    raise exception 'unknown id should raise';
  exception when no_data_found then null;
  end;

  -- The same receipt can never be recorded twice (unique constraint).
  begin
    update public.mpesa_transactions set mpesa_receipt = 'RCPT000001' where checkout_request_id = 'ws_sql_2';
    raise exception 'duplicate receipt should fail';
  exception when unique_violation then null;
  end;
end;
$$;

-- Signed-in users must not be able to settle their own orders.
set local role authenticated;
do $$
begin
  perform public.mpesa_settle_stk('ws_sql_2', 'success', 'paid', '');
  raise exception 'authenticated role must not execute mpesa_settle_stk';
exception when insufficient_privilege then null;
end;
$$;
reset role;

select 'mpesa_settle_stk: all assertions passed' as result;
rollback;
