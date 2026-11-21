-- LipaKit store: the three pre-order licences. Run once in the store's Supabase
-- SQL editor, after supabase/setup.sql. Safe to re-run (upserts by code).

-- The kit's demo subscription plans aren't sold here.
update public.plans set is_active = false;

insert into public.products (code, name, description, price_kes, features, sort_order) values
  ('lipakit_lite', 'Lite', 'For one product.', 6400,
   '{"1 product, 1 developer": true, "6 months of updates": true, "Community support": true}', 10),
  ('lipakit_solo', 'Solo', 'For everything you build yourself.', 12900,
   '{"Unlimited products of your own": true, "1 developer": true, "12 months of updates": true, "Community support": true}', 20),
  ('lipakit_agency', 'Agency', 'For client work and teams.', 38900,
   '{"Unlimited products, including for clients": true, "White-label": true, "Up to 5 developers": true, "12 months of updates": true, "Priority support": true}', 30)
on conflict (code) do update set
  name = excluded.name, description = excluded.description, price_kes = excluded.price_kes,
  features = excluded.features, sort_order = excluded.sort_order, is_active = true;
