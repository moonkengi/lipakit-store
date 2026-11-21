# LipaKit

A Next.js + Supabase starter kit for M-Pesa-powered SaaS. Daraja done right.

> **Status:** Milestone 4 (admin, alerts, payouts, health). Full docs arrive in Milestone 5.

## What's inside (so far)

- Next.js 16 (App Router, Cache Components), TypeScript strict, Tailwind CSS v4, shadcn/ui
- Supabase Postgres schema for plans, subscriptions, orders, M-Pesa transactions, callback log and receipts, with Row Level Security
- Sign-in with email magic link and Google (Supabase Auth)
- Marketing pages, pricing from the database, user dashboard and role-gated admin shell
- Zod-validated environment variables (`src/lib/env.ts`)
- M-Pesa STK push checkout with live status, callbacks that are logged first and verified with STK Query, idempotent settlement, and a status poller
- A local Daraja simulator for every outcome, including the failures Safaricom's sandbox can't produce
- Subscriptions with free trials, renewal reminders, grace and expiry; optional auto-renew with M-Pesa Ratiba standing orders
- Paybill/Till (C2B) payments matched to orders, with an unmatched queue
- PDF receipts, plus SMS (Africa's Talking) and email (Resend) notifications on your own accounts
- **Admin panel:**
  - revenue (today, month, MRR)
  - orders and payments search
  - users and subscriptions
  - unmatched payments with manual assignment
  - needs-review decisions
  - callback log with replay
  - B2C payouts
  - integrations
  - Health checks
- Alerts to Telegram, Slack, Discord, a signed webhook and web push; customers can link Telegram and turn on browser notifications

## Quick start

You need Node 20+, pnpm, and a Supabase project (the free tier is fine).

```bash
pnpm install
cp .env.example .env.local        # fill in the Supabase values
```

1. **Database.** In the Supabase SQL editor, run the files in `supabase/migrations/` in order, then `supabase/seed.sql`. Or with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.
2. **Auth redirect.** Supabase → Authentication → URL Configuration: set Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/callback` to Redirect URLs.
3. **Run it.**

   ```bash
   pnpm dev
   ```

   Open http://localhost:3000, sign in with your email, and you land on an empty dashboard.

4. **Schedule background jobs (when deployed).** Once the app is live on a public https URL, run this once in the Supabase SQL editor with your own URL and `CRON_SECRET`. It uses Supabase's built-in scheduler, which works on every plan, including free:

   ```sql
   select public.lipakit_schedule_jobs('https://your-app.vercel.app', 'your-CRON_SECRET');
   ```

   Locally, simulator mode runs the poller for you; no setup needed.

5. **Make yourself an admin.** Run the `update public.profiles ...` line at the bottom of `supabase/seed.sql` with your email, then visit `/admin`.

Google sign-in also needs the Google provider turned on in Supabase → Authentication → Providers.

## Paying with the simulator

With `MPESA_MODE=simulator` (the default) you need no Safaricom account.

1. Open http://localhost:3000/dev/simulator and pick an outcome: success, cancelled, timeout, insufficient funds, wrong PIN, duplicate callback, amount mismatch, missing callback, or late callback.
2. Go to `/pricing`, choose a plan, and pay with any Kenyan-format number (e.g. `0712345678`).
3. Watch the checkout update by itself. "Missing callback" and "late callback" take just over a minute: that's the status poller doing its job.
4. Try the rest of billing from `/dev/simulator`:
   - **Paybill payment:** send a C2B payment with an order's account number (it matches) or any other text (it lands in the unmatched queue).
   - **Renewals:** "Run renewals job now" sends reminders, moves overdue plans to grace, and expires them.
   - **Ratiba:** set `MPESA_RATIBA_ENABLED=true`, turn on automatic renewal on `/dashboard/billing`, then "Run payment" on the standing order.

## Scripts

| Command          | What it does                                                     |
| ---------------- | ---------------------------------------------------------------- |
| `pnpm dev`       | Run locally                                                      |
| `pnpm build`     | Production build                                                 |
| `pnpm test`      | Unit tests (Vitest)                                              |
| `pnpm lint`      | ESLint                                                           |
| `pnpm typecheck` | TypeScript, including generated route types                      |
| `pnpm db:types`  | Regenerate `database.types.ts` from your linked Supabase project |

## Renaming

Change `name` in `src/config/site.ts`. See `docs/DECISIONS.md` for why things are built the way they are.
