# Build Brief v2: LipaKit (M-Pesa SaaS Starter Kit + LipaKit Cloud)

v2 (2026-11-21) replaces the original brief. It keeps everything that still holds and adds a fix for each risk found when the idea was stress-tested. Section 0 lists those risks and where each is handled. Anything not mentioned as changed is the same as v1.

Ask Kent only when something is ambiguous or blocks you; otherwise decide and log it in `docs/DECISIONS.md`.

---

## 0. Risks and where they are handled

| #   | Risk                                                                                 | Fix                                                                                                                     | Section   |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | "No auto-debit" is out of date: M-Pesa Ratiba (standing orders) now has a Daraja API | Support Ratiba as an optional auto-renew method; STK reminders stay as the fallback                                     | 4.8, 6    |
| 2   | Daraja 3.0 self-service go-live weakens the go-live guide                            | Lead with what's still hard: callbacks, reconciliation, failure-state testing (the sandbox mostly only returns success) | 1, 4.7    |
| 3   | Paystack, IntaSend and Kopo Kopo already hide Daraja behind simple APIs              | Target buyers who must go direct to Daraja; add a payment-provider interface so Paystack/IntaSend can plug in later     | 1, 4.0    |
| 4   | AI agents make plain boilerplate cheap                                               | Sell production knowledge and a hosted service, not just code                                                           | 1, 12     |
| 5   | Small market, price-sensitive buyers, agencies reusing one copy                      | Validate with pre-orders before building more; licences priced per tier and team; local KES pricing                     | 1, 13, M0 |
| 6   | Code is copied, resold or leaked                                                     | Private repo, per-buyer access, watermarking, an anti-resale licence, and a hosted service that can't be copied         | 14        |
| 7   | Locked to Next.js + Supabase                                                         | Keep `lib/mpesa` framework-agnostic so it can ship as a standalone package, and Laravel/Django ports later              | 4.0, 15   |
| 8   | A one-off sale doesn't pay for ongoing maintenance                                   | Paid yearly update plan; Daraja-change tracking is part of the product                                                  | 13, 16    |
| 9   | Support load and liability when buyers' payments break                               | Support boundaries, diagnostics built in, strong warranty disclaimer                                                    | 16, 14    |
| 10  | Selling the kit internationally is awkward (payout holds, PayPal limits)             | Sell it with its own M-Pesa checkout (KES), plus a card option                                                          | 13        |
| 11  | The repo was public                                                                  | Make it private now; deliver through per-buyer access                                                                   | 14        |

## 1. Context and positioning

- **Owner:** Kent, a Nairobi-based founder and developer. **Never mention Kent's other or past products** anywhere in the kit, docs or marketing.
- **What this is:** two products that work together:
  1. **LipaKit (the kit):** a paid Next.js + Supabase starter for M-Pesa-powered SaaS. You buy it once, and updates are a yearly plan.
  2. **LipaKit Cloud:** a hosted callback relay and payment monitor. Monthly subscription. This is the long-term revenue and the part that can't be copied (section 12).
- **Who buys:** developers and agencies who **have to use Daraja directly**: they have their own Paybill or Till, want to avoid an aggregator's ~1.5% fee at volume, need money settled straight to their shortcode, or have a client who insists on going direct. Developers happy with an aggregator are not the target. Say that honestly in the marketing.
- **The pitch:** "M-Pesa payments that don't lose money." The hard part was never the STK push or getting approved. It is:
  - callbacks that arrive late, twice or never
  - payments that went through but the app doesn't know
  - reconciliation
  - testing failure cases the sandbox can't produce
  - recurring billing on a network built for one-off payments

  LipaKit solves these with code that has been tested on real payments.

- **Proof, not claims:** every hard path ships with a test and a simulator scenario, and the docs explain the real-world failure behind each one (late, duplicate and missing callbacks, result-code quirks, go-live rejections, reconciliation). An AI agent can write an STK push; it doesn't know these failure modes.
- **Quality bar:** unchanged. Buyers read every line.
- **Working name:** `LipaKit`, kept in `src/config/site.ts` only.

## 2. Stack

Unchanged from v1, plus:

- `lib/mpesa` and `lib/reconcile` must not import Next.js, Supabase or React. They take plain inputs and a small storage interface, so they can later be published as a standalone package (section 15).

## 3. Repository layout

Same as v1, plus:

```
/src/lib/payments          env wiring, Supabase settlement store, checkout, callback processing
/src/lib/mpesa/ratiba.ts   standing orders (M3)
/src/lib/license           licence-key check used by the update channel (M5)
/src/app/api/hooks/[token]/ratiba   (all Daraja callbacks live under /api/hooks: Safaricom rejects URLs containing "mpesa")
/scripts/doctor.ts         `pnpm doctor`: checks env, URLs, Daraja reachability, cron, webhook setup
LICENSE.md                 commercial licence (draft in repo; Kent finalises with a lawyer)
```

## 4. M-Pesa (Daraja) requirements

### 4.0 Switching providers (new)

The switching point is the `MpesaClient` interface (`stkPush`, `stkQuery`) plus the `StkStore` interface used by settlement. Daraja is the only v1 implementation. A buyer moving to Paystack or IntaSend writes one adapter that implements `MpesaClient`; nothing else changes. Don't build other providers in v1; document how. (Changed in M2: a separate `PaymentProvider` layer would have been an abstraction with one implementation. See DECISIONS.)

### 4.1–4.6

Unchanged from v1 (client basics, STK, callbacks with log-first and idempotency, status poller, C2B with an unmatched queue, B2C).

### 4.7 Simulator (now the headline feature)

Same as v1, plus:

- It covers **every failure the official sandbox can't produce**: insufficient funds (1), wrong PIN (2001), timeout (1037), user cancelled (1032), request in progress (1025), duplicate callback, late callback (arriving after the poller already resolved the payment), amount mismatch, and missing callback.
- A scenario can be scripted in tests (`simulate.stk({ outcome: "late_callback", delayMs: 90_000 })`), so buyers get a payment test suite, not just a demo page.
- Mention free alternatives (e.g. Pesa Playground) in the docs. LipaKit's simulator wins because it's wired into the app's own callback routes and tests.

### 4.8 Ratiba standing orders (new, M3)

- Optional auto-renew method: at checkout, a user can choose "Renew automatically with M-Pesa Ratiba" or "Remind me to pay".
- Implement standing-order creation and its callback, logged and idempotent like the rest. The sandbox endpoint seen in Daraja's docs is `POST /standingorder/v1/createStandingOrderExternal`. Treat the request/response fields, frequencies and limits as **confirm with Safaricom**.
- Document the real constraints:
  - **extra cost:** Safaricom charges a KSh 5 Ratiba fee on top of normal M-Pesa charges
  - **customer control:** the customer can cancel the standing order at any time, and it can't be edited, only deleted and recreated
  - **access:** production use needs approval from Safaricom after testing in the sandbox
- Ratiba payments still go through the same confirm-then-mark-paid path, never trusted from the callback alone.
- Behind `features.ratiba` so a buyer without Ratiba approval ships reminders only.

## 5. Data model

v1 tables (already migrated in M1), plus an M3 migration:

- `subscriptions.renewal_method` (`manual` / `ratiba`, default `manual`), `subscriptions.ratiba_order_ref`
- `mpesa_transactions.kind` gains `ratiba`; `mpesa_callbacks.kind` gains `ratiba`

## 6. Billing logic

Same as v1, but renewal now has two methods:

- **`manual` (default):** a daily cron creates a renewal order and sends a pay link 3 days before the period ends (SMS, email, and Telegram if linked).
- **`ratiba`:** the standing order is scheduled for the period end. If a Ratiba payment fails or the standing order is cancelled, switch to `manual` automatically and send the reminder flow. The user is never cut off without a reminder.
- In both cases a paid renewal extends from the old period end, and unpaid → `grace` → `expired`, as in v1.

## 7. App surfaces

Same as v1, plus:

- User dashboard: renewal method toggle (manual / Ratiba) where enabled.
- Admin: a "Health" page showing the last callback received per type, poller lag, unmatched count and `pnpm doctor` results. This is the first thing to check when a buyer says "payments are broken" (section 16).

## 8. Environment variables

v1 list, plus: `MPESA_RATIBA_ENABLED` (optional), `LIPAKIT_CLOUD_URL` and `LIPAKIT_CLOUD_KEY` (optional; relay mode, section 12), `LIPAKIT_LICENSE_KEY` (optional; update notices only, the app never stops working without it).

## 9. Documentation

v1 list, re-weighted:

- `03-mpesa-go-live.md` becomes shorter and goes into Daraja 3.0's self-service flow.
- New `08-failure-modes.md`: each real-world M-Pesa failure (described generically, with no reference to any specific product) and how the kit handles it. This is the content that's hardest to copy.
- New `09-ratiba.md`: when to use standing orders, costs, approval, fallback behaviour.
- New `10-support.md`: what's covered, how to file a useful report (`pnpm doctor` output + callback log row).

## 10. Milestones

**M0: Validate (Kent, in parallel with M2; no code)**

- A one-page site with the pitch, a demo video of the simulator scenarios, and pre-orders at a launch price.
- **Taking payments:** use a manual Paybill/Till with the account number set to the buyer's email, plus a card link. This changes to LipaKit's own checkout as soon as M2 works.
- Post in Kenyan developer communities and send it directly to 20 agencies.
- **Go / no-go:** **10+ paid pre-orders within 30 days** → finish M3–M5. Fewer → stop and reassess before more build time (e.g. ship only the open-source core plus Cloud).

**M1: Foundation**: done.

**M2: M-Pesa core**: v1 scope, plus the provider interface (4.0) and the full simulator failure list (4.7).

**M3: Billing, C2B, receipts, Ratiba**: v1 scope, plus Ratiba (4.8), renewal methods (6) and the fallback when a standing order fails.

**M4: Admin, Telegram, B2C, Health**: v1 scope, plus the Health page and `pnpm doctor`.

**M5: Docs, licence, delivery**: v1 scope, plus the failure-modes doc, the final licence, per-buyer delivery and watermarking (14), the update channel (13), and sales running on LipaKit's own checkout.

**M6: LipaKit Cloud (separate repo; only after M0 says go)**: the relay and monitor (12).

## 11. Rules for this build

Unchanged from v1, plus:

- The repo is private. Never make it public; open-source pieces go in a separate public repo when chosen.
- Keep `lib/mpesa` and `lib/reconcile` free of framework imports.

## 12. LipaKit Cloud (the moat), revised: buyer runs the heavy part

**Principle (Kent, 2026-11-21): buyers already pay for their own infrastructure, so anything that costs money to run happens on their accounts.** Cloud is redesigned around that.

- **Relay, self-hosted:** the callback relay ships as a Supabase Edge Function that runs in the **buyer's** Supabase project (the free tier includes generous invocations). Daraja → their Edge Function (logs, answers Safaricom fast, retries forwarding to their app). It stays up when their Vercel app is redeploying or down. Part of the paid kit, not a hosted service.
- **Cloud is a thin control plane Kent hosts:** it receives only small, payment-data-free heartbeats from each buyer's app (counts and timings: callbacks received, poller lag, failure rate, unmatched count; no phone numbers, names or amounts). From those it gives:
  - **alerts** (Telegram/email) when callbacks stop, failures spike or the poller falls behind, using the buyer's own Telegram bot or Resend key where possible
  - **a dashboard** across all of an agency's projects
  - **the Daraja change feed:** API changes, Safaricom IP list and result-code updates
- **Why this is better:** Kent's hosting cost per customer is tiny (a few small requests a minute), the data protection burden drops sharply because no payment data reaches Kent, and it scales without Kent paying for buyers' traffic.
- **Still sticky:** the alerting history, the multi-project view and the change feed are on Kent's side; the kit works fully without Cloud.
- **Hosting Cloud itself:** free tiers first (Supabase free + Vercel Hobby, with pg_cron for its own jobs); upgrade only when paying subscribers cover it.

## 13. Pricing and sales (agreed 2026-11-21)

| Tier            | Price                                    | Includes                                                                                                                |
| --------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Lite            | $49 / ~KES 6,400                         | Kit for **one** production project, 6 months of updates, community support. Same code as Solo; only the licence differs |
| Solo            | $99 / ~KES 12,900                        | Kit, unlimited own projects, 1 year of updates, community                                                               |
| Agency          | $299 / ~KES 38,900                       | Kit for unlimited client projects, white-label, 5 seats, 1 year of updates, priority support                            |
| Updates renewal | $29/yr Lite, $49/yr Solo, $149/yr Agency | Continued updates; the kit never stops working without it                                                               |
| Cloud           | from ~KES 1,500/month per project        | Relay, monitoring, reconciliation (section 12)                                                                          |

- Sell with LipaKit's own M-Pesa checkout in KES (the best demo there is), plus a card option for buyers outside Kenya through a merchant of record or Paystack.
- Launch pricing for M0 pre-orders, e.g. 40% off with lifetime updates for the first 20 buyers.
- Purchasing power: regional pricing for African countries outside Kenya. _Decide at M5._

## 14. Protecting the product

- **Repo:** private. Each buyer gets read access to a private delivery repo through GitHub invite, automated after payment, and removed on refund.
- **Watermarking:** each delivered copy gets a buyer-specific licence ID in `LICENSE.md` and `package.json`, plus a few harmless unique markers, so a leaked copy can be traced to its buyer.
- **Licence (draft in `LICENSE.md`):** unlimited end products for the licensed buyer; **no** redistributing, reselling or publishing the kit or derivatives _as a kit, template or library_; tier-based seat and client limits; no warranty, liability capped at the price paid; Kenyan law. _Kent finalises with a lawyer._
- **Leaks:** send DMCA / takedown notices to GitHub and file hosts, and revoke access and updates for the leaking licence.
- **Copycats:** you can't stop someone rebuilding the idea; win on being known, docs, production knowledge, and Cloud. Ship fast; don't publish the full roadmap.
- **No open-core:** everything stays paid (Kent's decision). `lib/mpesa` stays framework-agnostic for porting, but it isn't published free.

## 15. More stacks (after launch)

`lib/mpesa` is written to be extracted (section 2). Order: standalone TypeScript package → Laravel port → Django port, each only if buyers ask with pre-orders.

## 16. Support, liability and maintenance

- **Support scope:** bugs in the kit and setup questions, through GitHub issues on the delivery repo (Agency gets a faster response). Not covered: the buyer's own code changes, Safaricom account and approval issues, or general consulting (offer that as paid go-live help instead).
- **Self-diagnosis first:** `pnpm doctor`, the admin Health page and the troubleshooting doc should answer most "payments aren't working" questions before they reach Kent.
- **Disclaimer:** the licence, README and checkout all say the buyer is responsible for testing and running their own payment system.
- **Maintenance budget:** a monthly check of the Next.js, Supabase and Daraja changelogs; an `UPGRADING.md` per release; pin major versions. Update-plan revenue pays for this time.
- **Daraja-change tracking:** subscribe to Safaricom developer announcements; the Cloud change feed shares this work with paying users.

## 16b. Who pays for what

| Thing                                  | Runs on                                                                            | Paid by                              |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| App, API routes, callbacks             | Buyer's Vercel (Hobby works)                                                       | Buyer                                |
| Database, auth, storage, receipts PDFs | Buyer's Supabase                                                                   | Buyer                                |
| Scheduled jobs (poller, renewals)      | Buyer's Supabase pg_cron                                                           | Buyer (free on all plans)            |
| Callback relay (M6)                    | Buyer's Supabase Edge Function                                                     | Buyer                                |
| SMS / email / Telegram                 | Buyer's Africa's Talking, Resend, bot                                              | Buyer                                |
| M-Pesa                                 | Buyer's Daraja app and shortcode                                                   | Buyer                                |
| Simulator                              | Buyer's laptop                                                                     | Nobody                               |
| Kit delivery                           | GitHub private repo invites                                                        | Free                                 |
| Licence keys                           | Signed offline (Ed25519); verified in the kit with a public key, no licence server | Free                                 |
| Update notices                         | GitHub releases on the delivery repo                                               | Free                                 |
| Selling the kit                        | Kent's landing page on free tiers + LipaKit's own M-Pesa checkout                  | Kent (near zero)                     |
| Cloud control plane (M6)               | Kent's free tiers until revenue pays for upgrades                                  | Kent, covered by Cloud subscriptions |

## 17. Decisions made (2026-11-21)

1. **Pricing:** section 13 accepted, plus a lower **Lite** tier ($49, one project). Lite is a licence difference, not a code fork.
2. **Open-core:** no. Everything stays paid.
3. **Cloud:** yes, as M6, after M0 passes.
4. **M0 bar:** 10 paid pre-orders within 30 days.
5. **Past products:** never mentioned in the kit, docs or marketing.
6. **Buyer's resources first:** anything that costs money to run happens on the buyer's own accounts (section 16b). Scheduled jobs use the buyer's Supabase pg_cron, not Vercel Cron.
