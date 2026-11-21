# 05 · Deploy (Vercel + Supabase)

About 30 minutes, most of it waiting for DNS. Everything runs on your own accounts, and Vercel's free Hobby plan is enough.

## 1. Supabase (production project)

Use a **separate** Supabase project for production. Run `supabase/setup.sql` in its SQL editor (or `supabase db push`), then set its **Authentication → URL Configuration**:

- Site URL: `https://your-domain.co.ke`
- Redirect URLs: `https://your-domain.co.ke/auth/callback`

## 2. Vercel

1. Push the code to a **private** Git repository and import it in Vercel. The defaults (Next.js, `pnpm build`) are right.
2. Add every variable from your `.env.local` under **Settings → Environment Variables**, with production values:
   - `NEXT_PUBLIC_SITE_URL=https://your-domain.co.ke` (no trailing slash)
   - `MPESA_MODE=sandbox` or `production`. The app refuses to start a production deployment in simulator mode.
   - New random values for `MPESA_CALLBACK_TOKEN` and `CRON_SECRET` (don't reuse development ones).
3. Deploy, add your domain under **Settings → Domains**, and wait for HTTPS.

Changed an env var? Redeploy: Vercel reads env vars at build time.

## 3. Schedule the background jobs

Two jobs run on a schedule:

- **Status poller**, every minute: catches payments whose callback never arrived, and sends pending receipts.
- **Renewals**, daily at 06:00 Nairobi time: reminders, grace, expiry.

They run in **your Supabase project** with its built-in scheduler (pg_cron), which works on every Supabase plan. (Vercel Cron isn't used by default because on the Hobby plan a cron that runs more than once a day fails the deployment.) In the production project's SQL editor:

```sql
select public.lipakit_schedule_jobs('https://your-domain.co.ke', 'your-production-CRON_SECRET');
```

Re-run it if your domain or `CRON_SECRET` changes. To stop: `select public.lipakit_unschedule_jobs();`

Check it's working after a couple of minutes: the admin **Health** page shows the poller's last run, or in SQL:

```sql
select jobname, status, start_time from cron.job_run_details order by start_time desc limit 5;
```

**Alternatives:** on Vercel Pro you can use Vercel Cron instead. Any scheduler works (cron-job.org, GitHub Actions, your server): send `GET /api/cron/mpesa-poll` every minute and `GET /api/cron/renewals` daily with the header `Authorization: Bearer <CRON_SECRET>`.

## 4. M-Pesa

Follow [03 · Going live](03-mpesa-go-live.md): production credentials, then **Register C2B URLs** from `/admin/integrations` once your domain is final.

## 5. Telegram (optional)

1. Create a bot with [@BotFather](https://t.me/BotFather). Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (without @) and a random `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 24`).
2. For admin alerts, set `TELEGRAM_ADMIN_CHAT_IDS`: message your bot, then open `https://api.telegram.org/bot<token>/getUpdates` to find your chat ID.
3. Redeploy, then `/admin/integrations` → **Set Telegram webhook**. Customers can now link Telegram from **Settings**.

## 6. Other channels (optional)

| Channel  | Set                                                                  | Notes                                                                                               |
| -------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| SMS      | `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID`                          | Africa's Talking. Username `sandbox` uses their test API                                            |
| Email    | `RESEND_API_KEY`, `EMAIL_FROM`                                       | Verify your sending domain in Resend first                                                          |
| Slack    | `SLACK_WEBHOOK_URL`                                                  | Admin alerts. Slack → Apps → Incoming Webhooks                                                      |
| Discord  | `DISCORD_WEBHOOK_URL`                                                | Admin alerts. Server Settings → Integrations → Webhooks                                             |
| Webhook  | `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_SECRET`                          | Every event as signed JSON; verify with `verifyWebhookSignature()` from `src/lib/alerts/webhook.ts` |
| Web push | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `npx web-push generate-vapid-keys`. Users and admins opt in per browser                             |

Test admin channels with **Send a test alert** on `/admin/integrations`.

## 7. Final check

```bash
pnpm run doctor --env .env.production --url https://your-domain.co.ke
```

Fix anything red, then make a small real payment.
