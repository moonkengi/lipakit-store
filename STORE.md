# LipaKit store

LipaKit's own pre-order site, running on the kit itself with Paystack. Lives in `moonkengi/lipakit-store`; it is the kit + store copy (landing, terms, privacy, `supabase/store-seed.sql`, `netlify.toml`). Pull kit updates in with `git remote add kit https://github.com/moonkengi/lipakit && git fetch kit && git merge kit/main`.

## 1. Supabase (one-time)

1. Create a new Supabase project (free plan), e.g. `lipakit-store`.
2. SQL Editor: run `supabase/setup.sql`, then `supabase/store-seed.sql` (adds the Lite / Solo / Agency pre-orders and hides the demo plans).
3. Authentication → URL Configuration: Site URL `https://<your-site>.netlify.app`, Redirect URLs `https://<your-site>.netlify.app/auth/callback`.

## 2. Netlify

1. Add new project → Import from GitHub → `moonkengi/lipakit-store`, branch `main`. Build settings are read from `netlify.toml`.
2. Site configuration → Environment variables:

| Variable                                                                   | Value                                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                                                     | `https://<your-site>.netlify.app` (no trailing slash)           |
| `NEXT_PUBLIC_SUPABASE_URL`                                                 | Supabase → Project Settings → API                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                            | Supabase → Project Settings → API                               |
| `SUPABASE_SERVICE_ROLE_KEY`                                                | Supabase → Project Settings → API (secret)                      |
| `MPESA_MODE`                                                               | `sandbox` while testing, `production` when live                 |
| `PAYMENT_PROVIDER`                                                         | `paystack`                                                      |
| `PAYSTACK_SECRET_KEY`                                                      | Paystack → Settings → API Keys & Webhooks (`sk_test_...` first) |
| `MPESA_CALLBACK_TOKEN`                                                     | Output of `openssl rand -hex 24`                                |
| `CRON_SECRET`                                                              | Output of `openssl rand -hex 24` (a different value)            |
| `RESEND_API_KEY`, `EMAIL_FROM`                                             | Optional, for receipts by email                                 |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ADMIN_CHAT_IDS` | Optional, to get a Telegram message per pre-order               |

3. Deploy. Changed a variable? Redeploy.

## 3. After the first deploy

1. **Jobs:** Supabase SQL Editor → `select public.lipakit_schedule_jobs('https://<your-site>.netlify.app', '<CRON_SECRET>');`
2. **Paystack webhook:** Paystack → Settings → API Keys & Webhooks → Test webhook URL: `https://<your-site>.netlify.app/api/hooks/<MPESA_CALLBACK_TOKEN>/paystack`
3. **Admin:** sign in once, then in SQL: `update public.profiles set role = 'admin' where email = '<you>';`
4. **Check:** `/admin/health` should be green, including "Paystack secret key: Key accepted (test mode)".
5. **Paystack compliance:** use `https://<your-site>.netlify.app` as the website.

## Going live

When Paystack approves compliance: set `PAYSTACK_SECRET_KEY` to the live key, `MPESA_MODE=production`, set the **live** webhook URL in Paystack, redeploy, and make one small real payment.
