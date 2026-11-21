-- Paystack as an alternative M-Pesa provider (PAYMENT_PROVIDER=paystack):
-- its webhooks are logged in mpesa_callbacks like Daraja callbacks.
alter table public.mpesa_callbacks drop constraint mpesa_callbacks_kind_check;
alter table public.mpesa_callbacks
  add constraint mpesa_callbacks_kind_check
  check (kind in ('stk', 'c2b_validate', 'c2b_confirm', 'b2c_result', 'b2c_timeout', 'ratiba', 'paystack'));
