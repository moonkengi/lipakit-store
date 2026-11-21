-- =============================================================================
-- Row Level Security.
--
-- Rules (from the brief):
--   * Users read only their own rows.
--   * Admins (profiles.role = 'admin') read everything.
--   * Payment tables are written only server-side with the service role,
--     which bypasses RLS. So there are deliberately NO insert/update/delete
--     policies on plans, subscriptions, orders, mpesa_*, or receipts.
-- =============================================================================

-- is_admin(): security definer so it can read profiles without recursing
-- through the profiles RLS policy that calls it.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
-- anon needs execute too: the public plans policy calls it (it just returns false).
grant execute on function public.is_admin() to anon, authenticated, service_role;

alter table public.profiles           enable row level security;
alter table public.plans              enable row level security;
alter table public.subscriptions      enable row level security;
alter table public.orders             enable row level security;
alter table public.mpesa_transactions enable row level security;
alter table public.mpesa_callbacks    enable row level security;
alter table public.receipts           enable row level security;

-- --- profiles ----------------------------------------------------------------
create policy "profiles: read own or admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Column-level guard: users may edit their name and phone, never their role
-- or Telegram link (those are set server-side).
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone) on public.profiles to authenticated;

-- --- plans: public catalogue ---------------------------------------------------
create policy "plans: anyone reads active plans"
  on public.plans for select to anon, authenticated
  using (is_active or (select public.is_admin()));

-- --- user-owned payment tables --------------------------------------------------
create policy "subscriptions: read own or admin"
  on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "orders: read own or admin"
  on public.orders for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "mpesa_transactions: read own or admin"
  on public.mpesa_transactions for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.orders o
      where o.id = mpesa_transactions.order_id and o.user_id = (select auth.uid())
    )
  );

create policy "receipts: read own or admin"
  on public.receipts for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.orders o
      where o.id = receipts.order_id and o.user_id = (select auth.uid())
    )
  );

-- --- callback log: admins only (raw payloads include phone numbers) -------------
create policy "mpesa_callbacks: admin reads"
  on public.mpesa_callbacks for select to authenticated
  using ((select public.is_admin()));
