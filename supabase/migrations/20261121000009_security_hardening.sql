-- Security hardening from the Supabase security advisor.

-- Fixed search_path so the function can't be tricked by objects in other schemas.
alter function public.set_updated_at() set search_path = '';

-- handle_new_user only ever runs as the auth.users trigger; nobody should call it over the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- is_admin() stays callable: the RLS policies use it, and it only ever answers
-- "is the CURRENT user an admin?" (false for anonymous visitors).
