# 11 · Paystack (no shortcode yet)

No Paybill or Till of your own yet? Run real M-Pesa payments through **Paystack**. Paystack sends the STK push from its own shortcode and pays out to your bank or M-Pesa account. Everything else in the kit stays the same: checkout, live status, the poller, receipts, renewals and the admin panel.

Switch to your own shortcode later by changing two environment variables. No code changes.

## What you get, and what you don't

|                                                        | Paystack                                                             | Your own shortcode (Daraja) |
| ------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------- |
| STK push checkout, renewals, receipts                  | Yes                                                                  | Yes                         |
| Card payments                                          | Not through the kit's checkout (yet)                                 | No                          |
| Paying from the M-Pesa menu (Paybill + account number) | No                                                                   | Paybill only                |
| Ratiba automatic renewal                               | No                                                                   | Yes                         |
| B2C payouts                                            | No                                                                   | Yes                         |
| Fees                                                   | Paystack's (1.5% per M-Pesa payment in Kenya at the time of writing) | Safaricom's tariff only     |
| Who you need to be                                     | An individual with an ID can start (Starter Business)                | A shortcode holder          |

Check Paystack's current pricing, limits and account requirements on their site; Starter accounts have a collection cap until you upgrade.

## Set up

1. **Account.** Sign up at [paystack.com](https://paystack.com) (Kenya). You can test straight away in **test mode**. Live payments need the compliance forms in **Compliance** to be approved.
2. **Keys.** Dashboard → **Settings → API Keys & Webhooks**. Copy the **test secret key** (`sk_test_...`) into `.env.local`:

   ```bash
   MPESA_MODE=sandbox            # any non-simulator mode; Paystack's key decides test vs live
   PAYMENT_PROVIDER=paystack
   PAYSTACK_SECRET_KEY=sk_test_...
   ```

   The Daraja variables (`MPESA_CONSUMER_KEY` and friends) aren't needed. Keep `MPESA_RATIBA_ENABLED=false`.

3. **Webhook.** On the same Paystack page, set **Webhook URL** to:

   ```
   https://<your-domain>/api/hooks/<MPESA_CALLBACK_TOKEN>/paystack
   ```

   Paystack signs every webhook with your secret key; the kit rejects anything unsigned. The webhook only makes payments settle faster: the poller verifies pending payments with Paystack every minute anyway.

4. **Check.** `pnpm run doctor` (or the admin **Health** page) shows **Paystack secret key: Key accepted (test mode)**.
5. **Pay.** Buy a plan from `/pricing`. Paystack's test mode doesn't move real money; check Paystack's docs for its test phone numbers.

## Going live

When Paystack approves your compliance forms, swap in the **live secret key** (`sk_live_...`), set `MPESA_MODE=production`, update the webhook URL on the **live** side of the same Paystack page, and redeploy. Make one small real payment.

## How it stays safe

Exactly the rules from [08 · Failure modes](08-failure-modes.md):

- **A webhook is a hint.** Every result is re-checked with Paystack's Verify Transaction API before anything changes. The amount Paystack verifies is compared with the order; a short payment goes to **Needs review**.
- **Missing webhooks don't matter.** The poller verifies anything still pending after a minute, and expires it after 10 minutes.
- **Duplicates can't double-count.** Settlement is the same race-safe database function as for Daraja.
- **Every webhook is logged first** and can be replayed from `/admin/callbacks`.

Paystack's failure messages are mapped onto the kit's result codes (cancelled, insufficient funds, wrong PIN, unreachable) by their wording, so customers see the usual friendly messages. Unrecognised failures show a generic "didn't go through". The mapping is in `src/lib/mpesa/paystack.ts`; _confirm edge cases with Paystack_.

## Moving to your own shortcode

Get a Paybill or Till ([03](03-mpesa-go-live.md)), then set `PAYMENT_PROVIDER=daraja` and the `MPESA_*` Daraja variables, redeploy, and register C2B URLs. Old Paystack payments stay in your history; new ones go through Daraja.
