# 04 · Billing

M-Pesa can't be charged automatically like a card, so subscriptions work as a conversation: remind, collect, extend. Optionally, a customer can approve an M-Pesa standing order (Ratiba) once and renewals pay themselves ([09](09-ratiba.md)).

## The lifecycle

```
sign up ──► trial (if the plan has trial_days) ──► active ──► reminder (3 days before end)
                                                    ▲              │
                                       paid ────────┘              ▼ not paid by the end
                                                                 grace (GRACE_DAYS, still has access)
                                                                   │ not paid
                                                                   ▼
                                                                expired
```

- **Trial:** offered on the checkout page to accounts that have never had a subscription. No grace after a trial: an unpaid trial expires at its end. Trial users get the same 3-day reminder.
- **Reminder:** the daily renewals job creates one renewal **bill** (an order) and sends SMS, email, Telegram and push, with a pay link and, for Paybills, the account number to use from the M-Pesa menu.
- **Paying:** from the billing page (STK push) or the M-Pesa menu (Paybill + account number). Either one renews.
- **Extension:** a paid renewal extends from the **old period end**, not the payment date. Paying early never loses days; paying during grace doesn't gift the grace days.
- **Grace:** `GRACE_DAYS` (default 3) after the period ends. The customer keeps access and gets a "keep your plan" message. `GRACE_DAYS=0` expires immediately.
- **Expired:** access stops; any unpaid bills are cancelled. Paying again starts a fresh period from the payment date.
- **Cancel:** customers can choose "Cancel at end of period" on the billing page. No reminders, no grace; the plan ends as `canceled` on its end date.

## Where it lives

| What                                | Where                                                               |
| ----------------------------------- | ------------------------------------------------------------------- |
| The rules (reminder, grace, expiry) | `src/lib/billing/renewals.ts` (pure, unit tested)                   |
| Running them daily                  | `src/lib/billing/renewals-runner.ts`, `/api/cron/renewals`          |
| Money → access (the one place)      | `billing_apply_paid_order()` in `supabase/migrations/…_billing.sql` |
| Feature gating                      | `hasAccess(user, "feature")` in `src/lib/billing/access.ts`         |
| Receipts                            | `src/lib/billing/fulfil.ts`, `src/lib/receipts/pdf.ts`              |
| Messages                            | `src/lib/notify/messages.ts`                                        |

**One guarantee:** every way an order becomes paid (STK, Paybill, Ratiba, an admin assigning or approving) goes through `billing_apply_paid_order()` in the same transaction. "Paid" always means "receipt exists and subscription updated".

## Plans

Plans are rows in the `plans` table (see `supabase/seed.sql`):

| Column       | Meaning                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `code`       | Stable identifier, used in URLs (`/dashboard/checkout?plan=pro_monthly`) |
| `price_kes`  | Whole shillings                                                          |
| `interval`   | `month`, `quarter` or `year`                                             |
| `trial_days` | 0 for no trial                                                           |
| `features`   | JSON of feature keys, e.g. `{"reports": true, "max_projects": 10}`       |
| `is_active`  | Inactive plans disappear from pricing; existing subscribers keep them    |

### Changing plans

Upgrades and downgrades take effect when the renewal for the new plan is paid. The customer picks the new plan on `/pricing`, pays, and the subscription switches plan and extends from the current period end. Simple, and nobody is charged a prorated amount they can't verify. To change prices, update `price_kes`: existing subscribers pay the new price at their next renewal.

## One-time products

Not everything is a subscription. Pre-orders, e-books, courses or a setup fee go in the `products` table: `code`, `name`, `description`, `price_kes`, `features` (shown as lines on the pricing page, e.g. `{"Lifetime access": true}`), `sort_order`, `is_active`.

```sql
insert into public.products (code, name, description, price_kes, features)
values ('course_basics', 'M-Pesa Basics course', 'Six video lessons.', 2500, '{"Lifetime access": true}');
```

- Products appear on `/pricing` (alone if you have no plans, or under "One-time purchases").
- Checkout is `/dashboard/checkout?product=<code>`: the same M-Pesa flow, with `purpose = 'one_off'`.
- A paid product order gets a numbered receipt with the product's name. It never creates or changes a subscription.
- Unlock things with `hasPurchased(user, "course_basics")` from `src/lib/billing/access.ts`. Only paid orders count.

## Receipts

A receipt number (`LK-2026-000123`; prefix from `siteConfig.receiptPrefix`) is issued inside the payment transaction, so numbers are unique and never skipped. The PDF is built afterwards, stored privately in your Supabase Storage (`receipts` bucket), emailed and texted. Each of those steps records its own timestamp and retries for 7 days if it fails. Customers download receipts from the billing page through a 60-second signed link.

## Edge cases worth knowing

- **Paid twice** (STK and Paybill for the same renewal): both count, so the customer gets two periods. Refund one with a payout if they ask.
- **Paybill payment with the wrong amount:** the order goes to **Needs review**; an admin approves (grants access) or rejects (no access; refund the money).
- **Paybill payment with an unknown account number:** **Unmatched payments**; an admin assigns it to the right order.
- **Paying an order that's already paid:** lands in Unmatched as a possible double payment.
