# 06 · Troubleshooting

Start with the admin **Health** page or `pnpm run doctor`. Most problems show up there in red.

## The customer paid, but the app doesn't know

The poller handles this: STK pushes still pending after 60 seconds get an STK Query to Daraja, which settles them even if the callback never arrives. If payments stay "pending":

1. **Health → Status poller.** If it says "never ran" or "looks stopped", scheduling isn't set up: run `lipakit_schedule_jobs()` ([05](05-deploy.md)).
2. **`/admin/callbacks`.** Did a callback arrive? If it has an error, fix the cause and click **Replay**.
3. **Daraja credentials.** Health → Daraja credentials must be green, since the poller needs them to query.

## Callbacks never arrive

- **URL not public.** Daraja can't reach `localhost`. Use a deployment or a tunnel.
- **Not https** (production).
- **Blocked words.** Safaricom rejects URLs containing "M-PESA", "Safaricom", "exe", "exec", "cmd", "SQL" or "query", including in your domain. Health → Callback URLs checks this.
- **Wrong token.** If `MPESA_CALLBACK_TOKEN` changed after the push was sent, Daraja calls the old URL and gets a 404. The poller still settles STK payments; re-register C2B URLs.
- **C2B only:** URLs not registered, or registered against an old domain. In production, changing them may need Safaricom support.

## The prompt never reaches the phone

- The number isn't a Safaricom M-Pesa line, or the phone is off or out of coverage (result 1037).
- Another M-Pesa transaction is in progress on that phone (1001): wait and retry.
- The sandbox is occasionally slow or down; try the simulator to rule out your code.

## Duplicate payments

The kit can't double-count the same M-Pesa transaction: receipts and checkout IDs are unique, and settling only happens once (see [08](08-failure-modes.md)). A customer can still genuinely pay twice (e.g. STK and then Paybill): both count. Look in **Unmatched payments** for "possible double payment" and refund with a payout if needed.

## "Invalid Access Token" or 401 from Daraja

Wrong consumer key or secret, sandbox keys used with `MPESA_MODE=production` (or the reverse), or the app isn't enabled for that API in the Daraja portal. The client retries once with a fresh token automatically.

## Receipts or messages not sent

Health → Notifications shows which channels are configured. Receipts retry every minute for 7 days. Check:

- **Email:** the `EMAIL_FROM` domain is verified in Resend.
- **SMS:** your Africa's Talking balance and sender ID approval. Username `sandbox` doesn't deliver real SMS.

## Result codes

What the kit does with each STK result code. Safaricom publishes no single authoritative list; these meanings are the commonly observed ones _(confirm with Safaricom)_. Codes not listed are treated as a failed payment.

| Code                         | Meaning                                      | Transaction   | Order         | What the customer sees                  |
| ---------------------------- | -------------------------------------------- | ------------- | ------------- | --------------------------------------- |
| 0                            | Paid                                         | success       | paid          | Payment received                        |
| 1                            | Insufficient balance                         | failed        | failed        | Balance too low; top up or use Fuliza   |
| 1001                         | Another transaction in progress on the phone | failed        | failed        | Wait a moment, then try again           |
| 1019                         | Transaction expired                          | timeout       | expired       | Request expired; try again              |
| 1025                         | Couldn't send the prompt                     | failed        | failed        | Couldn't send the prompt; try again     |
| 1032                         | Cancelled by the customer                    | cancelled     | cancelled     | You cancelled the payment               |
| 1037                         | Phone unreachable / no response              | timeout       | expired       | Make sure your phone is on and unlocked |
| 2001                         | Wrong PIN                                    | failed        | failed        | The PIN was incorrect                   |
| 9999                         | Couldn't send the prompt                     | failed        | failed        | Couldn't send the prompt; try again     |
| `500.001.1001` (query error) | Not finished yet                             | stays pending | stays pending | (still waiting)                         |

Pushes with no result after 10 minutes are expired by the poller. Customer messages are in `src/lib/mpesa/result-codes.ts`; edit them there.
