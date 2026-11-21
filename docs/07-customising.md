# 07 · Customising

## Rename the product

Change `name` (and `description`, `supportEmail`, `receiptPrefix`) in `src/config/site.ts`. That's the only place the name lives: page titles, emails, SMS, receipts and the Telegram bot's replies all read it. `receiptPrefix` is also used for order account numbers; keep it to 2–3 letters so account numbers stay within M-Pesa's 12-character limit.

## Retheme

All colours are CSS variables at the top of `src/app/globals.css` (shadcn/ui "neutral" with a green primary). Change `--primary` for your brand colour; everything follows. Fonts are set in `src/app/layout.tsx`.

Need more components? `components.json` is set up, so `pnpm dlx shadcn@latest add dialog` (or any component) works.

## Add a plan

Insert a row (or add it to `supabase/seed.sql` and re-run it, since it upserts by `code`):

```sql
insert into public.plans (code, name, description, price_kes, interval, trial_days, features, sort_order)
values ('team_quarterly', 'Team', 'For small teams.', 4000, 'quarter', 14,
        '{"projects": true, "max_projects": 50, "reports": true}', 40);
```

It appears on `/pricing` immediately. Highlight a plan as "Most popular" with `featuredPlanCode` in `src/config/site.ts`.

## Sell something once

Add a row to `products` (see [04 · Billing](04-billing.md#one-time-products)) and check ownership with `hasPurchased(user, "<code>")`.

## Gate a feature

1. Add a key to the plans that should have it, e.g. `"reports": true` in `plans.features`.
2. Check it on the server:

```tsx
import { requireUser } from "@/lib/auth";
import { hasAccess, getLimit } from "@/lib/billing/access";

export default async function ReportsPage() {
  const user = await requireUser();
  if (!(await hasAccess(user, "reports"))) return <p>Reports are on the Pro plan.</p>;
  const maxProjects = await getLimit(user, "max_projects"); // number or null
  // ...
}
```

A feature is on when its value is `true`, a positive number or a non-empty string. Trial, active and grace subscriptions have access. The dashboard's **Reports** card is a working example.

Gate in pages, server actions and route handlers, the places that touch data, not in `src/proxy.ts` (Next.js advises against data fetching there).

## Change customer messages

All SMS and email text is in `src/lib/notify/messages.ts`; M-Pesa result messages are in `src/lib/mpesa/result-codes.ts`. Keep SMS under 160 characters to stay within one SMS.

## Swap a provider

Each external service sits behind a small interface:

- **SMS** (`SmsSender`), **email** (`EmailSender`), **Telegram** (`TelegramSender`): `src/lib/notify/types.ts`
- **Admin alert channels** (`AlertChannel`): `src/lib/alerts/types.ts`
- **M-Pesa itself** (`MpesaClient`): `src/lib/mpesa/types.ts`. A Paystack or IntaSend adapter implements `stkPush` and `stkQuery`; settlement, the poller and the UI stay the same.

Write the adapter, then wire it in `src/lib/notify/index.ts`, `src/lib/alerts/index.ts` or `src/lib/payments/mpesa-client.ts`.

## Turn sign-in methods on or off

`src/config/features.ts`: `magicLink`, `googleAuth`, `phoneOtp` (see [01](01-setup.md) for phone setup).

## Database types

The typed Supabase client uses `src/lib/supabase/database.types.ts`. After changing the schema, regenerate it from your linked project with `pnpm db:types`, and run `pnpm db:bundle` to refresh `supabase/setup.sql`.
