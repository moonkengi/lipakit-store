# Changelog

Each release lists **Database** changes (new migrations to apply) and anything **Breaking**. See [UPGRADING.md](UPGRADING.md).

## 1.0.0 (unreleased)

First release.

**Payments (M-Pesa Daraja)**

- STK push with STK Query reconciliation: callbacks are hints, the query is the truth. Race-safe settlement in Postgres.
- Status poller for missing and late callbacks; expiry after 10 minutes.
- C2B (Paybill / Till): validation and confirmation, matching by account number or phone + amount, unmatched queue, needs-review queue.
- Ratiba standing orders for automatic renewal, with fallback to reminders.
- B2C payouts with idempotency keys, result and timeout handling.
- Callback log with replay. Callback URLs that respect Safaricom's blocked words.
- Full simulator with every outcome, including duplicate, late and missing callbacks.

**Billing**

- Plans with trials, monthly / quarterly / yearly intervals and feature flags (`hasAccess`, `getLimit`).
- Reminders, grace period, expiry, cancel at period end. Renewals extend from the old period end.
- Numbered PDF receipts, stored in Supabase Storage, sent by email and SMS.

**Admin**

- Overview with revenue, orders, users, unmatched payments, review queue, callback log, payouts, integrations and health checks.
- Alerts to Telegram, Slack, Discord, a signed webhook and web push.

**Auth & notifications**

- Email magic link, Google, and phone SMS codes (Africa's Talking via Supabase's Send SMS hook).
- Customer messages by SMS, email, Telegram and web push.

**Setup**

- `supabase/setup.sql` one-paste database setup, `pnpm demo:data`, `pnpm run doctor`.
- Background jobs on Supabase pg_cron (works on Vercel Hobby).

**Database:** migrations `0001`–`0006`.
