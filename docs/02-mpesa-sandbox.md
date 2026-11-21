# 02 · M-Pesa sandbox

The simulator covers every outcome and failure on your laptop. The sandbox is Safaricom's test environment: it proves your credentials, URLs and network path work with real Daraja servers before you touch real money.

## Simulator vs sandbox

|                                                                                      | Simulator              | Sandbox             |
| ------------------------------------------------------------------------------------ | ---------------------- | ------------------- |
| Needs a Safaricom account                                                            | No                     | Yes (free)          |
| Real Daraja servers                                                                  | No                     | Yes                 |
| Failure cases (cancelled, wrong PIN, timeout, duplicates, late or missing callbacks) | All of them, on demand | Mostly success only |
| Needs a public URL                                                                   | No                     | Yes, for callbacks  |

Keep using the simulator for day-to-day work and tests. Use the sandbox to check the connection, then move to production.

## 1. Create a Daraja account and app

1. Sign up at [developer.safaricom.co.ke](https://developer.safaricom.co.ke).
2. Create an app and tick the APIs you'll use: **M-Pesa Express** (STK push), **M-Pesa Express Query**, **Customer To Business** (C2B), and **Business To Customer** if you'll send payouts. Ratiba has its own product; see [09](09-ratiba.md).
3. Copy the app's **Consumer Key** and **Consumer Secret**.
4. From the sandbox test credentials page, copy the **Lipa Na M-Pesa Online passkey** for the test shortcode **174379**.

## 2. Point the kit at the sandbox

In `.env.local`:

```bash
MPESA_MODE=sandbox
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...
MPESA_SHORTCODE=174379
MPESA_PASSKEY=...
MPESA_TILL_OR_PAYBILL=paybill
```

Restart the app. `pnpm run doctor` now also checks that Daraja issues an OAuth token with your credentials.

## 3. Give Daraja a public URL

Daraja delivers results to your callback URL over the internet, so `localhost` won't work. Options:

- **Deploy** a preview to Vercel (see [05](05-deploy.md)), or
- **Tunnel** your laptop: e.g. `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, then set `NEXT_PUBLIC_SITE_URL` to the https address it gives you.

Two rules from Safaricom:

- **No blocked words in callback URLs.** Safaricom rejects URLs containing "M-PESA", "Safaricom", "exe", "exec", "cmd", "SQL" or "query". The kit's callbacks live under `/api/hooks/<secret>/...` for this reason, and it refuses to register a URL that breaks the rule. Watch your own domain name too.
- **Don't use tunnels in production.** Safaricom's C2B guidance says to avoid public URL testers like ngrok in production; they're fine for the sandbox.

## 4. Test an STK push

Pay for a plan from `/pricing` with your own Safaricom number. The sandbox sends a real prompt to your phone; no money moves. Watch the order on `/admin/orders` and the raw callback on `/admin/callbacks`.

If the prompt never arrives, see [06 · Troubleshooting](06-troubleshooting.md). If the callback never arrives, wait about a minute: the status poller asks Daraja directly.

## 5. Test C2B (Paybill payments)

1. Open `/admin/integrations` and click **Register C2B URLs**.
2. Use Daraja's C2B simulate API (from the portal's API explorer) to send a test payment to 174379 with an order's account number as the bill reference.
3. It should appear as paid on that order, or in `/admin/unmatched` if the account number doesn't match.

In the sandbox, re-registering URLs is allowed. In production it may not be (see [03](03-mpesa-go-live.md)).

## What the sandbox can't show you

The sandbox mostly returns success. Cancelled prompts, wrong PINs, insufficient funds, timeouts, duplicate, late and missing callbacks are what the simulator is for, and every one of them is covered by the kit's tests.
