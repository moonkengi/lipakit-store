-- =============================================================================
-- LipaKit schema: tables, constraints, indexes, triggers.
-- RLS policies live in the next migration so each file stays readable.
--
-- Conventions
--   * Every table: id uuid PK, created_at timestamptz.
--   * Money is integer Kenyan shillings (M-Pesa has no cents).
--   * Status columns are text + CHECK rather than Postgres enums, because
--     adding a value to a CHECK is a one-line migration and enums are not.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Helper: keep updated_at current on mutable tables.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user. Created automatically on sign-up.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  full_name        text,
  email            text,
  phone            text check (phone is null or phone ~ '^254[17][0-9]{8}$'),
  role             text not null default 'user' check (role in ('user', 'admin')),
  telegram_chat_id bigint unique
);

comment on column public.profiles.phone is 'Normalised Kenyan MSISDN, e.g. 254712345678.';
comment on column public.profiles.email is 'Copied from auth.users on sign-up for admin search. auth.users stays the source of truth.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile whenever a user signs up (magic link, Google, ...).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- plans: what you sell. Displayed on the pricing page.
-- -----------------------------------------------------------------------------
create table public.plans (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  code        text not null unique check (code ~ '^[a-z0-9_]+$'),
  name        text not null,
  description text,
  price_kes   integer not null check (price_kes > 0),
  interval    text not null check (interval in ('month', 'quarter', 'year')),
  trial_days  integer not null default 0 check (trial_days >= 0),
  -- Feature keys this plan unlocks, e.g. {"reports": true, "max_projects": 5}.
  features    jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  sort_order  integer not null default 0,
  is_active   boolean not null default true
);

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- subscriptions: a user's access to a plan over time.
-- There is no auto-debit with M-Pesa; renewals are paid orders (see docs/04-billing.md).
-- -----------------------------------------------------------------------------
create table public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  plan_id              uuid not null references public.plans (id),
  status               text not null check (status in ('trialing', 'active', 'grace', 'expired', 'canceled')),
  current_period_start timestamptz not null,
  current_period_end   timestamptz not null,
  grace_until          timestamptz,
  cancel_at_period_end boolean not null default false,
  check (current_period_end > current_period_start)
);

-- One live subscription per user keeps billing logic simple in v1.
create unique index subscriptions_one_live_per_user
  on public.subscriptions (user_id)
  where status in ('trialing', 'active', 'grace');

create index subscriptions_period_end_idx on public.subscriptions (current_period_end)
  where status in ('trialing', 'active', 'grace');

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- orders: something a user owes money for. Created BEFORE calling Daraja.
-- -----------------------------------------------------------------------------
create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  plan_id         uuid references public.plans (id),
  purpose         text not null check (purpose in ('subscription', 'renewal', 'one_off')),
  amount_kes      integer not null check (amount_kes > 0),
  -- Shown to the customer and used as the Paybill account number for C2B.
  -- Daraja limits AccountReference to 12 characters (confirm with Safaricom).
  account_ref     text not null unique check (char_length(account_ref) between 4 and 12),
  status          text not null default 'pending'
                  check (status in ('pending', 'paid', 'failed', 'expired', 'needs_review', 'cancelled')),
  status_reason   text,
  paid_at         timestamptz,
  check ((status = 'paid') = (paid_at is not null) or status = 'needs_review')
);

create index orders_user_id_idx on public.orders (user_id, created_at desc);
create index orders_status_idx on public.orders (status) where status in ('pending', 'needs_review');

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- mpesa_transactions: one row per Daraja money movement (STK, C2B, B2C).
-- The unique constraints are the idempotency backbone: a repeated callback
-- cannot create a second transaction.
-- -----------------------------------------------------------------------------
create table public.mpesa_transactions (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  order_id            uuid references public.orders (id) on delete set null,
  kind                text not null check (kind in ('stk', 'c2b', 'b2c')),
  merchant_request_id text,
  checkout_request_id text unique,
  mpesa_receipt       text unique,
  phone               text,
  amount_kes          integer check (amount_kes is null or amount_kes > 0),
  result_code         integer,
  result_desc         text,
  status              text not null default 'pending'
                      check (status in ('pending', 'success', 'failed', 'cancelled', 'timeout', 'unmatched')),
  -- Last raw Daraja payload for this transaction, for debugging.
  raw                 jsonb,
  check (kind <> 'stk' or checkout_request_id is not null)
);

create index mpesa_transactions_order_id_idx on public.mpesa_transactions (order_id);
create index mpesa_transactions_pending_idx on public.mpesa_transactions (created_at)
  where status = 'pending';
create index mpesa_transactions_unmatched_idx on public.mpesa_transactions (created_at)
  where status = 'unmatched';

create trigger mpesa_transactions_set_updated_at
  before update on public.mpesa_transactions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- mpesa_callbacks: raw log of every inbound Daraja callback, written FIRST.
-- Nothing is ever lost: processing errors are recorded on the row.
-- -----------------------------------------------------------------------------
create table public.mpesa_callbacks (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  kind         text not null check (kind in ('stk', 'c2b_validate', 'c2b_confirm', 'b2c_result', 'b2c_timeout')),
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text,
  replay_count integer not null default 0
);

create index mpesa_callbacks_received_at_idx on public.mpesa_callbacks (received_at desc);
create index mpesa_callbacks_unprocessed_idx on public.mpesa_callbacks (received_at)
  where processed_at is null;

-- -----------------------------------------------------------------------------
-- receipts: one per paid order. PDF lives in Supabase Storage.
-- -----------------------------------------------------------------------------
create table public.receipts (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  order_id   uuid not null unique references public.orders (id) on delete restrict,
  number     text not null unique,
  pdf_path   text,
  emailed_at timestamptz,
  sms_at     timestamptz
);
