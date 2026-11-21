-- =============================================================================
-- Scheduled jobs that run in YOUR Supabase project (pg_cron + pg_net), on any
-- Supabase plan. They call the app's protected /api/cron/* routes.
--
-- Why not Vercel Cron: on Vercel's Hobby plan, a cron that runs more than once
-- a day fails the deployment. pg_cron runs every minute on every Supabase plan.
--
-- This migration only creates helper functions; nothing is scheduled until you
-- run, once, in the Supabase SQL editor (see docs/05-deploy.md):
--
--   select public.lipakit_schedule_jobs('https://your-app.vercel.app', 'your-CRON_SECRET');
--
-- Re-run it after changing your domain or CRON_SECRET. To stop everything:
--
--   select public.lipakit_unschedule_jobs();
-- =============================================================================

create or replace function public.lipakit_schedule_jobs(p_app_url text, p_cron_secret text)
returns setof text  -- names of the jobs now scheduled
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_url text := rtrim(p_app_url, '/');
begin
  if v_url !~ '^https://' then
    raise exception 'p_app_url must be your public https:// URL, e.g. https://your-app.vercel.app';
  end if;
  if char_length(p_cron_secret) < 16 then
    raise exception 'p_cron_secret must be the CRON_SECRET from your app environment (16+ characters)';
  end if;

  -- Both extensions are available on every Supabase plan.
  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;

  -- Secrets live in Supabase Vault, encrypted at rest, never in the job text.
  -- Note: while a request is queued, pg_net stores its headers in
  -- net.http_request_queue, readable by database roles that can log in. CRON_SECRET
  -- only allows triggering the cron routes, so the exposure is limited.
  delete from vault.secrets where name in ('lipakit_app_url', 'lipakit_cron_secret');
  perform vault.create_secret(v_url, 'lipakit_app_url');
  perform vault.create_secret(p_cron_secret, 'lipakit_cron_secret');

  -- M-Pesa status poller: every minute.
  perform cron.schedule(
    'lipakit-mpesa-poll',
    '* * * * *',
    $job$
      select net.http_get(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'lipakit_app_url') || '/api/cron/mpesa-poll',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lipakit_cron_secret')
        ),
        timeout_milliseconds := 55000
      );
    $job$
  );
  return next 'lipakit-mpesa-poll';

  -- Milestone 3 adds the daily renewals job here.
end;
$$;

create or replace function public.lipakit_unschedule_jobs()
returns setof text  -- names of the jobs removed
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job record;
begin
  for v_job in select jobname from cron.job where jobname like 'lipakit-%' loop
    perform cron.unschedule(v_job.jobname);
    return next v_job.jobname;
  end loop;
  delete from vault.secrets where name in ('lipakit_app_url', 'lipakit_cron_secret');
end;
$$;

-- Only the database owner (you, in the SQL editor) may schedule jobs. Never the API.
revoke all on function public.lipakit_schedule_jobs(text, text) from public, anon, authenticated;
revoke all on function public.lipakit_unschedule_jobs() from public, anon, authenticated;
