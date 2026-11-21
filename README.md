# LipaKit

A Next.js + Supabase starter kit for M-Pesa-powered SaaS. Daraja done right.

> **Status:** Milestone 2 (M-Pesa core). Billing, admin tools and the full docs arrive in later milestones.

## What's inside (so far)

- Next.js 16 (App Router, Cache Components), TypeScript strict, Tailwind CSS v4, shadcn/ui
- Supabase Postgres schema for plans, subscriptions, orders, M-Pesa transactions, callback log and receipts, with Row Level Security
- Sign-in with email magic link and Google (Supabase Auth)
- Marketing pages, pricing from the database, user dashboard and role-gated admin shell
- Zod-validated environment variables (`src/lib/env.ts`)
- M-Pesa STK push checkout with live status, callbacks that are logged first and verified with STK Query, idempotent settlement, and a status poller
- A local Daraja simulator for every outcome, including the failures Safaricom's sandbox can't produce

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

4. **Make yourself an admin.** Run the `update public.profiles ...` line at the bottom of `supabase/seed.sql` with your email, then visit `/admin`.

Google sign-in also needs the Google provider turned on in Supabase → Authentication → Providers.

## Paying with the simulator

With `MPESA_MODE=simulator` (the default) you need no Safaricom account.

1. Open http://localhost:3000/dev/simulator and pick an outcome: success, cancelled, timeout, insufficient funds, wrong PIN, duplicate callback, amount mismatch, missing callback, or late callback.
2. Go to `/pricing`, choose a plan, and pay with any Kenyan-format number (e.g. `0712345678`).
3. Watch the checkout update by itself. "Missing callback" and "late callback" take just over a minute: that's the status poller doing its job.

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
