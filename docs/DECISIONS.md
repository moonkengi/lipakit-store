# Design decisions

A running log of choices made while building the kit, newest last. Each entry says what was decided and why, so you can undo it knowingly.

## M1: Foundation (2026-11-21)

**Next.js 16 with Cache Components on.** `create-next-app` now enables `cacheComponents` and `partialPrefetching`, and Next.js says both become mandatory in the next major. We keep them on so buyers don't inherit a migration. In practice: anything that reads cookies, headers or `searchParams` renders inside a `<Suspense>` boundary, and layouts never `await` the session at the top level (see the `SignedIn` / `AdminOnly` gates in the dashboard and admin layouts).

**`src/proxy.ts`, not `middleware.ts`.** Next.js 16 renamed middleware to proxy. It refreshes the Supabase session and redirects signed-out visitors away from `/dashboard` and `/admin`. That redirect is a convenience only; `requireUser()` / `requireAdmin()` in `src/lib/auth.ts` are the real checks. `/api/*` is excluded from the proxy so M-Pesa callbacks, cron and webhooks are never redirected to a login page.

**`getClaims()` over `getUser()`.** Supabase now recommends `getClaims()` on the server: it verifies the JWT signature (locally with asymmetric keys) instead of a network round-trip per request.

**Non-admins get a 404 at `/admin`, not a 403.** Doesn't advertise that an admin area exists.

**Status columns are `text` + `CHECK`, not Postgres enums.** Adding a status later is a one-line constraint change; altering enums inside transactions is awkward.

**One live subscription per user** (partial unique index on `subscriptions(user_id)` where status is trialing/active/grace). Keeps v1 billing logic simple, matching the brief's "upgrades apply at next renewal".

**`orders.account_ref` is 4–12 characters.** Daraja's STK `AccountReference` is documented at 12 characters max. _Confirm with Safaricom._ It also doubles as the Paybill account number for C2B matching.

**Extra columns beyond the brief:** `updated_at` on mutable tables; `profiles.email` (copied on sign-up, for admin search); `plans.description` and `plans.sort_order` (pricing page); `orders.plan_id` (which plan a subscription/renewal order is for) and `orders.status_reason` (human-readable reason for failed/needs_review).

**Users can update only `full_name` and `phone` on their profile** (column-level grants). `role` and `telegram_chat_id` are set server-side, so a user can't promote themselves.

**Admins read through RLS, write through the service role.** Admin pages use the normal user-scoped client for reads (admin RLS policies allow it) and will use `createAdminClient()` only for writes, after `requireAdmin()`.

**Lazy server-env validation plus a boot check.** `getServerEnv()` parses on first use; `src/instrumentation.ts` calls it at server start so a bad config fails at boot. Real Daraja credentials are required only when `MPESA_MODE` isn't `simulator`. SMS, email and Telegram are optional, but their key pairs must be set together.

**Pricing reads plans per request.** Simpler than caching and always fresh. To cache it, wrap `getActivePlans()` in `'use cache'` with `cacheTag('plans')` and call `updateTag('plans')` when an admin edits a plan.

**shadcn/ui primitives were written by hand in M1** (Button, Input, Label, Card, Badge), matching shadcn's source and dependencies, because the shadcn registry wasn't reachable from the build environment. `components.json` is present, so `pnpm dlx shadcn@latest add <component>` works as normal.

**Phone OTP is behind `features.phoneOtp` (off) and not built yet.** Supabase's phone auth needs a supported SMS provider. Africa's Talking isn't one of the built-in options, so it needs Supabase's "Send SMS" auth hook. Planned alongside the SMS notifier in M3.

**Typed database client from a hand-written `database.types.ts`.** Matches the migrations exactly so the kit type-checks with no Supabase project. `pnpm db:types` replaces it with CLI-generated types.

## Brief v2 (2026-11-21)

**The brief moved to `docs/BRIEF.md` (v2) after a stress test of the idea.** Main changes: an optional auto-renew method using M-Pesa Ratiba (standing orders), a payment-provider interface, a simulator covering every failure the sandbox can't produce, a validation milestone (M0) before the build goes further, LipaKit Cloud (hosted callback relay) as the recurring-revenue part, private per-buyer delivery with watermarking, and a draft commercial licence. Section 0 of the brief maps each risk to its fix.

**`lib/mpesa` and `lib/reconcile` stay framework-agnostic** (no Next.js, Supabase or React imports), so the core can later ship as a standalone package or be ported to Laravel/Django.

**The repo must be private.** It was briefly public after the first push; see BRIEF section 14.

## M2: M-Pesa core (2026-11-21)

**A callback is a hint; STK Query is the truth, for failures too.** Daraja callbacks are unsigned, so every callback (success or failure) is confirmed with STK Query before anything settles. Verifying failures matters: a forged "cancelled" callback could otherwise close an order the customer then really pays. Callback details (amount, receipt, phone) are used only when they agree with the verified result.

**The decision is in TypeScript; atomic application is in SQL.** `src/lib/reconcile/stk.ts` decides the statuses (pure, unit tested). The `mpesa_settle_stk()` Postgres function applies them under a row lock and only to a `pending` transaction, which is what makes duplicate callbacks, late callbacks and the poller racing each other safe. Execute permission is revoked from `anon` and `authenticated`; without that, any signed-in user could call it through the API and mark their own order paid.

**The switching point to other providers is the `MpesaClient` and `StkStore` interfaces**, not a separate `PaymentProvider` layer (brief v2 §4.0 is updated). A second abstraction with one implementation would be code nobody uses. A Paystack or IntaSend adapter implements `MpesaClient` (`stkPush` / `stkQuery`).

**Result codes:** 1037 (phone unreachable) and 1019 (expired) mark the order `expired`; 1032 marks it `cancelled`; 1, 2001, 1001, 1025, 9999 and unknown codes mark it `failed`. Each has a customer-facing message in `result-codes.ts`. Safaricom publishes no authoritative list; meanings are marked "confirm with Safaricom".

**STK Query "still processing" (`errorCode 500.001.1001`) means pending, not an error.** Commonly observed value; confirm with Safaricom.

**Late callbacks may only fill in a missing receipt.** If the poller settled a success first, a later callback can add the M-Pesa receipt number and nothing else. The receipt isn't re-verified (STK Query doesn't return it); the money trail is already confirmed.

**`needs_review` orders get `paid_at` too.** Money was received; a human decides what to do with it.

**Every checkout attempt is a new order.** Retrying after "cancelled" or "wrong PIN" creates a fresh order with a fresh `account_ref`; stale pending ones expire after 10 minutes. Simpler than reusing an order across several STK pushes.

**Rate limit:** at most 3 pending orders per user in 2 minutes, so an account can't be used to spam payment prompts to someone else's phone.

**Subscription activation is not in M2.** A paid order is the M2 end state; M3 extends `mpesa_settle_stk()` to activate or extend the subscription and create the receipt in the same transaction.

**Buy Goods (Till) support:** `MPESA_TILL_NUMBER` was added for tills whose number (PartyB) differs from the store number (BusinessShortCode).

**Simulator:** state is in memory on `globalThis` (shared across route handlers in one dev server, lost on restart), and it's meant for `pnpm dev` / `pnpm start` on your machine. Env validation refuses `MPESA_MODE=simulator` on a Vercel production deployment. `src/instrumentation.ts` calls the poller every 20 seconds in simulator mode, standing in for Vercel Cron, so "missing callback" scenarios resolve locally.

**`/dev/simulator` outside simulator mode** renders the standard not-found page but with HTTP 200, because with Partial Prerendering the status is sent before the mode check streams in. The real lock is `/api/dev/simulate`, which returns 404 outside simulator mode, so the page has nothing to talk to.

**Database tests** for the settlement function live in `tests/sql/` and run with `pnpm test:sql` against a local Supabase. They run in a transaction that is rolled back.

## Running on the buyer's resources (2026-11-21)

**Principle: the kit runs entirely on the buyer's own accounts** (their Vercel, Supabase, Daraja app, Africa's Talking, Resend, Telegram bot). Nothing in the kit calls a server Kent pays for. Kent's running costs stay close to zero, and buyers' payment data never passes through Kent, so the Data Protection Act exposure is theirs alone.

**Scheduled jobs run in the buyer's Supabase (pg_cron + pg_net), not Vercel Cron.** On Vercel Hobby, any cron that runs more than once a day fails the deployment, so M2's per-minute `vercel.json` would have broken every free-plan buyer's deploy; it has been removed. pg_cron is available on every Supabase plan. `public.lipakit_schedule_jobs(app_url, cron_secret)` stores the URL and secret in Supabase Vault and schedules the jobs; `public.lipakit_unschedule_jobs()` removes them. Both are callable only by the database owner (SQL editor), never through the API. Vercel Pro users can still use Vercel Cron, and any other scheduler can call `/api/cron/*` with the bearer secret.

_Not yet run against a real Supabase project_ (no pg_cron in the build sandbox): the SQL follows Supabase's documented `cron.schedule` + `net.http_*` + Vault pattern. Confirm on first setup that `select * from cron.job_run_details order by start_time desc limit 5;` shows successful runs.

**Known exposure:** while a request is queued, pg_net keeps its headers (including `CRON_SECRET`) in `net.http_request_queue`, readable by database roles that can log in. `CRON_SECRET` only allows triggering the cron routes, so the exposure is limited.

## M3: Billing, C2B, receipts, Ratiba (2026-11-21)

**All Daraja callbacks moved to `/api/hooks/<token>/...`.** Safaricom's docs say to avoid "M-PESA", "Safaricom", "exe", "exec", "cmd", "SQL" and "query" in callback URLs, and C2B registration rejects them. M2's `/api/mpesa/callback/...` would have failed C2B registration. `MPESA_CALLBACK_TOKEN` is now also checked for those words and must be URL-safe. `assertDarajaSafeUrl()` runs before every registration, so a domain containing a blocked word fails with a clear message.

**Money turns into access in exactly one place: `billing_apply_paid_order()`.** Every settle path (STK, C2B, Ratiba) calls it inside the same transaction that marks the order paid, so "paid" always means "receipt exists and subscription updated".

- Paid renewals extend from the **old period end**: paying early never loses days, and paying during grace doesn't gift the grace days.
- An expired subscription gets a fresh one starting now.
- **Plan changes take effect when the renewal order for the new plan is paid** (including the features). That's simpler than storing a pending plan change.

**Renewal bills:** the daily job creates one pending renewal order per subscription, 3 days before the end. Its `account_ref` doubles as the Paybill account number in the reminder. STK payments from the billing page create their own orders, as in M2. When any renewal is paid, other open bills for that subscription are cancelled as superseded, except ones with an STK push still in flight. If a customer pays twice (STK and Paybill), both payments are applied (two periods); an admin can refund.

**Trials:** one per account (only for users who have never had a subscription). No grace period: an unpaid trial expires at its end. Trial users get the same 3-day reminder.

**STK and C2B for the same payment.** A Paybill with C2B URLs registered also receives a C2B confirmation for STK payments, with `TransID` equal to the STK receipt. Whichever arrives first settles the order. The other is a no-op, because receipts are unique and the order only moves from an unpaid status. Covered by `tests/sql/billing.sql`.

**C2B matching order:** account number, then Ratiba reference, then phone + exact amount (only when exactly one unpaid order in the last 48 hours fits, and only when Daraja sends the phone unmasked), else the unmatched queue. A wrong amount goes to `needs_review`. Paying an already-paid order goes to the unmatched queue as a possible double payment. We register C2B with **v1** of the URL API because v2 masks the payer's phone. _Confirm with Safaricom_ which version your shortcode supports.

**C2B confirmations aren't re-verified.** Unlike STK, there's no query to call without the Transaction Status API, which needs initiator credentials. Protection is the secret token, unique `TransID`, optional IP allowlisting, and the amount check. Adding Transaction Status verification is an M4 option.

**C2B validation** accepts everything by default (`MPESA_C2B_VALIDATION=accept`). `match` rejects unknown account numbers. Validation only runs if Safaricom enabled it on the shortcode, and logging never delays the answer.

**Ratiba assumption (confirm with Safaricom):** Daraja's docs describe the approval callback but not how each recurring payment arrives. We assume each one reaches the Paybill/Till as a C2B confirmation whose `BillRefNumber` is the standing order's `AccountReference`, and match on that. If the assumption is wrong, nothing breaks: the period ends unpaid, the subscription falls back to manual renewal with a bill and a message, and grace applies. Daraja documents no cancel API, so turning auto-renew off tells the user to remove the standing order with *334#.

**Receipts:**

- **Numbers** (`PREFIX-YEAR-000123`) come from a Postgres sequence inside the settle transaction. A re-run checks first so it never burns a number.
- **PDFs** are built with `pdf-lib` (pure JS) and stored in a private `receipts` bucket in the buyer's Supabase. They're served only through 60-second signed URLs after an RLS check.
- **Delivery:** PDF, email and SMS each record their own timestamp, so fulfilment is safe to retry. Callbacks run it straight away and the every-minute poller sweeps up failures for 7 days.

**Notifications are optional per channel.** With no keys set, sending is skipped (logged once at startup), never an error. A receipt is marked sent when the customer has no email or phone on file, so it isn't retried forever.

**`hasAccess()` is not used in `src/proxy.ts`.** Next.js advises against data fetching there; gate pages and routes instead (see the Reports card on the dashboard).

**Daily renewals job** is added to `lipakit_schedule_jobs()` at 03:00 UTC (06:00 Nairobi). Re-run that SQL after applying this migration if you scheduled jobs before.
