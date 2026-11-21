-- LipaKit store: the three pre-order licences. Run once in the store's Supabase
-- SQL editor, after supabase/setup.sql. Safe to re-run (upserts by code).

-- The kit's demo subscription plans aren't sold here.
update public.plans set is_active = false;

insert into public.products (code, name, description, price_kes, features, sort_order) values
  ('lipakit_lite', 'Lite', 'For one product.', 6400,
   '{"lines": ["1 product, 1 developer", "6 months of updates", "Community support"]}', 10),
  ('lipakit_solo', 'Solo', 'For everything you build yourself.', 12900,
   '{"lines": ["Unlimited products of your own", "1 developer", "12 months of updates", "Community support"]}', 20),
  ('lipakit_agency', 'Agency', 'For client work and teams.', 38900,
   '{"lines": ["Unlimited products, including for clients", "White-label", "Up to 5 developers", "12 months of updates", "Priority support"]}', 30)
on conflict (code) do update set
  name = excluded.name, description = excluded.description, price_kes = excluded.price_kes,
  features = excluded.features, sort_order = excluded.sort_order, is_active = true;
