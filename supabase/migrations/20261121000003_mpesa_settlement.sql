-- =============================================================================
-- M-Pesa settlement: the atomic, idempotent "this STK push is now final" step.
--
-- The decision (which status, which message) is made in TypeScript
-- (src/lib/reconcile/stk.ts, unit tested). This function only applies it, and
-- guarantees that a transaction leaves `pending` exactly once, even when the
-- callback, a duplicate callback and the poller arrive at the same moment.
-- =============================================================================

create or replace function public.mpesa_settle_stk(
  p_checkout_request_id text,
  p_tx_status           text,
  p_order_status        text,
  p_order_reason        text,
  -- Optional parameters default to null, so generated TypeScript types mark them optional.
  p_result_code         integer default null,
  p_result_desc         text    default null,
  p_receipt             text    default null,
  p_phone               text    default null,
  p_raw                 jsonb   default null
)
returns text   -- 'settled' | 'noop' | 'receipt_added'
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tx public.mpesa_transactions%rowtype;
begin
  -- Row lock: concurrent callers queue here, and the second one sees the first one's result.
  select * into v_tx
  from public.mpesa_transactions
  where checkout_request_id = p_checkout_request_id and kind = 'stk'
  for update;

  if not found then
    raise exception 'unknown checkout_request_id %', p_checkout_request_id using errcode = 'no_data_found';
  end if;

  if v_tx.status <> 'pending' then
    -- Already final. The only thing a later message may add is a missing receipt
    -- (the poller can settle a success before the callback brings the receipt).
    if v_tx.status = 'success' and v_tx.mpesa_receipt is null and p_receipt is not null then
      update public.mpesa_transactions set mpesa_receipt = p_receipt where id = v_tx.id;
      return 'receipt_added';
    end if;
    return 'noop';
  end if;

  update public.mpesa_transactions
  set status        = p_tx_status,
      result_code   = p_result_code,
      result_desc   = p_result_desc,
      mpesa_receipt = coalesce(p_receipt, mpesa_receipt),
      phone         = coalesce(p_phone, phone),
      raw           = coalesce(p_raw, raw)
  where id = v_tx.id;

  -- The order only moves if nothing else has finalised it yet.
  -- (M3 extends this step: activate/extend the subscription and create the receipt.)
  update public.orders
  set status        = p_order_status,
      status_reason = p_order_reason,
      paid_at       = case when p_order_status in ('paid', 'needs_review') then now() else paid_at end
  where id = v_tx.order_id and status = 'pending';

  return 'settled';
end;
$$;

-- Server-side only. Without this, any signed-in user could call it through the
-- API and mark their own order paid.
revoke all on function public.mpesa_settle_stk(text, text, text, text, integer, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mpesa_settle_stk(text, text, text, text, integer, text, text, text, jsonb) to service_role;

-- <MpesaCheckout /> listens for its order's status over Supabase Realtime.
-- Realtime respects RLS, so users only receive changes to their own orders.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;

