-- =============================================================================
-- Demo data. Runs on `supabase db reset` (local) or paste into the SQL editor.
-- Safe to re-run: plans upsert on code.
-- =============================================================================

insert into public.plans (code, name, description, price_kes, interval, trial_days, features, sort_order)
values
  ('starter_monthly', 'Starter', 'For trying things out.',          500,  'month',   7, '{"projects": true, "max_projects": 1}',                 10),
  ('pro_monthly',     'Pro',     'For growing teams.',              1500, 'month',   7, '{"projects": true, "max_projects": 10, "reports": true}', 20),
  ('pro_yearly',      'Pro (yearly)', 'Pro, billed yearly. Two months free.', 15000, 'year', 0, '{"projects": true, "max_projects": 10, "reports": true}', 30)
on conflict (code) do update set
  name        = excluded.name,
  description = excluded.description,
  price_kes   = excluded.price_kes,
  interval    = excluded.interval,
  trial_days  = excluded.trial_days,
  features    = excluded.features,
  sort_order  = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- Making yourself an admin
-- -----------------------------------------------------------------------------
-- 1. Sign in to the app once (so your auth user and profile exist).
-- 2. Run this with your email:
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
--
-- 3. Sign out and back in (or refresh). /admin is now visible.
