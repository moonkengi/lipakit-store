# 09 · Ratiba (automatic renewal)

M-Pesa Ratiba lets a customer approve a **standing order** once: M-Pesa then pays your shortcode on a schedule, with no prompt each time. The kit offers it as an optional "automatic renewal" on the billing page. Customers who don't use it get reminders as usual.

## When to use it

Good for monthly or yearly plans where customers would rather not pay by hand. Not needed for one-off payments. Keep reminders as the default: Ratiba is a convenience, not a requirement.

## Costs and limits

- **Fee:** Safaricom charges a small Ratiba fee per standing-order payment, on top of normal M-Pesa charges. Mention it to customers (the billing page does).
- **Customers stay in control:** they can cancel the standing order anytime from *334# → M-PESA Ratiba or the Ratiba mini app. A standing order can't be edited, only deleted and created again.
- **Access:** test in the sandbox first; production use needs approval from Safaricom _(confirm the current process with Safaricom)_.

## Turning it on

1. In the Daraja portal, add the **M-Pesa Ratiba** product to your app and test it in the sandbox.
2. Set `MPESA_RATIBA_ENABLED=true` and redeploy.
3. Customers with an active plan see **Automatic renewal** on `/dashboard/billing`. They enter their number and approve the prompt; the kit marks the subscription as Ratiba once Safaricom's callback confirms.

## How it works in the kit

1. **Request:** `requestRatiba()` (`src/lib/billing/subscriptions.ts`) creates a standing order starting at the current period end, with the plan's frequency (monthly, quarterly, yearly) and the plan price. Its **AccountReference** is a reference unique to the subscription.
2. **Approval:** Safaricom calls `/api/hooks/<token>/ratiba` after the customer approves or declines (`src/lib/payments/ratiba.ts`).
3. **Each payment:** arrives at your shortcode, is matched to the subscription by that AccountReference, creates a renewal order and settles it through the same `billing_apply_paid_order()` as every payment.
4. **No reminders** are sent for Ratiba subscriptions.
5. **Fallback:** if a period ends unpaid (standing order cancelled, insufficient balance), the subscription switches back to manual: grace starts, a bill is created, and the customer gets a message. Nobody loses access without warning.

## The assumption to confirm

Safaricom's Ratiba documentation describes the approval callback but **not how each recurring payment is delivered**. The kit assumes each one reaches your Paybill or Till as a normal C2B confirmation whose `BillRefNumber` is the standing order's AccountReference, which is how a payment to a Paybill normally looks. **Confirm with Safaricom (apisupport@safaricom.co.ke) before relying on it.**

If the assumption is wrong, nothing breaks: payments that don't match land in the Unmatched queue (assign them manually), and the fallback above keeps customers covered.

## Turning it off

A customer clicks **Turn off automatic renewal**: the subscription goes back to reminders. Daraja documents no API for cancelling a standing order, so they must also remove it on their phone (*334#). The billing page tells them.

## Trying it locally

In simulator mode with `MPESA_RATIBA_ENABLED=true`, turn on automatic renewal on the billing page (approval arrives after the simulator delay), then on `/dev/simulator` click **Run payment** next to the standing order to simulate one scheduled payment.
