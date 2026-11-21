-- One-time products: things sold once rather than by subscription
-- (pre-orders, e-books, courses, setup fees). A paid one_off order gets a
-- receipt like any other; billing_apply_paid_order leaves subscriptions alone.

create table public.products (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  code        text not null unique check (code ~ '^[a-z0-9_]+$'),
  name        text not null,
  description text,
  price_kes   integer not null check (price_kes > 0),
  -- Display lines or anything your app needs, e.g. {"updates_months": 12}.
  features    jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  sort_order  integer not null default 0,
  is_active   boolean not null default true
);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products enable row level security;

create policy "products: anyone reads active products"
  on public.products for select to anon, authenticated
  using (is_active or (select public.is_admin()));

alter table public.orders add column product_id uuid references public.products (id);
create index orders_product_id_idx on public.orders (product_id) where product_id is not null;

-- A product order is always a one-off, and never also a plan order.
alter table public.orders
  add constraint orders_product_is_one_off
  check (product_id is null or (purpose = 'one_off' and plan_id is null));
