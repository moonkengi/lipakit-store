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
