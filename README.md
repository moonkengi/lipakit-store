# LipaKit

A Next.js + Supabase starter kit for SaaS products paid with M-Pesa. STK push, Paybill, subscriptions, receipts, admin and alerts, with the failure cases handled.

## Quick start (about 10 minutes)

You need Node 20+, pnpm and a free Supabase project. No Safaricom account: you start on the built-in M-Pesa simulator.

1. **Install**

   ```bash
   pnpm install
   cp .env.example .env.local
   ```

2. **Database.** In Supabase → SQL Editor, paste all of `supabase/setup.sql` and run it.

3. **Env.** In `.env.local`, fill in the three Supabase values (Project Settings → API) and two random secrets:

   ```bash
   openssl rand -hex 24   # → MPESA_CALLBACK_TOKEN
   openssl rand -hex 24   # → CRON_SECRET
   ```

   Leave `MPESA_MODE=simulator`.

4. **Auth redirect.** Supabase → Authentication → URL Configuration: Site URL `http://localhost:3000`, and add `http://localhost:3000/auth/callback` to Redirect URLs.

5. **Run**

   ```bash
   pnpm dev
   ```

   Sign in at http://localhost:3000 with your email.

6. **Admin + demo data**

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

   ```bash
   pnpm demo:data      # demo customers, payments, a trial, an overdue plan, review items
   pnpm run doctor     # checks env, database, scheduler and channels
   ```

   Open `/admin`.

## Pay with the simulator

1. Open `/dev/simulator` and pick an outcome: success, cancelled, timeout, insufficient funds, wrong PIN, duplicate callback, amount mismatch, missing callback or late callback.
2. Go to `/pricing`, choose a plan, and pay with any Kenyan number (e.g. `0712345678`).
3. Watch the checkout update by itself. "Missing" and "late callback" take about a minute: that's the status poller at work.
4. From `/dev/simulator` you can also send a Paybill payment, run the renewals job, and (with `MPESA_RATIBA_ENABLED=true`) run a standing-order payment.

## What's inside

- **M-Pesa:** STK push confirmed by STK Query, race-safe settlement, status poller, C2B Paybill/Till matching with unmatched and review queues, Ratiba auto-renewal, B2C payouts, callback log with replay, and a simulator for every outcome.
- **Billing:** plans, trials, reminders, grace, expiry, cancel at period end, feature gating with `hasAccess()`, numbered PDF receipts.
- **Admin:** revenue, orders, users, unmatched payments, review queue, callbacks, payouts, integrations, health checks.
- **Notifications:** SMS (Africa's Talking), email (Resend), Telegram and web push for customers; Telegram, Slack, Discord, a signed webhook and web push for admin alerts.
- **Auth:** email magic link, Google, and phone SMS codes.
- **Stack:** Next.js 16 (App Router), TypeScript strict, Tailwind v4, shadcn/ui, Supabase (Postgres, Auth, Storage, pg_cron). Everything runs on your own accounts; Vercel Hobby and Supabase Free are enough to launch.

## Docs

Start at [docs/README.md](docs/README.md): setup, sandbox, going live, billing, deploy, troubleshooting, customising, failure modes, Ratiba and support.

## Scripts

| Command                        | What it does                                            |
| ------------------------------ | ------------------------------------------------------- |
| `pnpm dev`                     | Run locally                                             |
| `pnpm build`                   | Production build                                        |
| `pnpm test`                    | Unit tests (Vitest)                                     |
| `pnpm test:sql`                | Database function tests (needs `DATABASE_URL`)          |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript                                     |
| `pnpm run doctor`              | Check your setup (`--url` for a deployment)             |
| `pnpm demo:data`               | Load demo data (simulator mode only)                    |
| `pnpm db:types`                | Regenerate `database.types.ts` from your linked project |
| `pnpm db:bundle`               | Rebuild `supabase/setup.sql` after changing migrations  |

## Make it yours

Change `name` and `description` in `src/config/site.ts`, the colours in `src/app/globals.css`, and the landing page in `src/app/(marketing)/page.tsx`. See [07 · Customising](docs/07-customising.md).

## Licence

Commercial licence; see [LICENSE.md](LICENSE.md). Keep your copy in a private repository.
