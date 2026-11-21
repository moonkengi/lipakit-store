# Selling LipaKit (seller only)

This file, `docs/BRIEF.md` and `scripts/release/` are excluded from every buyer copy by `.gitattributes` (export-ignore). Never send them.

## M0: LipaKit's own store, on Paystack

The pre-order store is a deployment of LipaKit itself with `PAYMENT_PROVIDER=paystack` (docs/11-paystack.md). It proves the kit on real money, and its receipts are your sales records.

1. **Paystack compliance** (you, in the dashboard): finish the 5 forms under Compliance. Until they're approved only test mode works.
2. **Store repo:** a private copy of the kit (e.g. `moonkengi/lipakit-store`), with LipaKit's real landing copy, the Lite / Solo / Agency pre-order plans, and `PAYMENT_PROVIDER=paystack`.
3. **Host:** Netlify's free plan allows a paid product (Vercel's free Hobby plan doesn't). Domain: your own domain, or a subdomain while you validate.
4. **Keys:** paste the Paystack secret key into the host's environment variables yourself, and set the webhook URL in Paystack to `https://<domain>/api/hooks/<MPESA_CALLBACK_TOKEN>/paystack`.
5. **Each paid pre-order** shows up in `/admin/orders` with a receipt, and you get an alert. At release, run `issue.mjs` for each buyer.

## Manual alternative: no store

Take payment through a **Paystack Starter Business** account and deliver each sale by hand with `issue.mjs`.

### One-time setup

1. **Paystack:** sign up at paystack.com (Kenya) as a Starter Business: national ID plus your personal bank or M-Pesa account for settlement. _Check Paystack's current requirements and limits_: at the time of writing, M-Pesa collections cost 1.5% and Starter accounts have a collection cap (about KES 250,000) until you upgrade with business documents.
2. **Products:** create a **Payment Page** (or Product) for each tier, priced in KES at your USD prices (Lite $49, Solo $99, Agency $299; renewals $29 / $49 / $149). Turn on M-Pesa and card. Collect name and email; add a custom field for the **GitHub username** (optional).
3. **Licence signing key:** `node scripts/release/keys.mjs`. The private key goes to `~/.lipakit/license-private.pem`; **back it up** (password manager + an offline copy). Paste the printed public key into `src/config/license.ts` and commit.
4. **Finalise `LICENSE.md`:** have a Kenyan lawyer review it, fill in the refund policy (replace `{{REFUND_POLICY}}`), and remove the DRAFT notice. `issue.mjs` refuses to package until both are done (`--allow-draft` for test copies only).
5. **Delivery repo (optional):** a separate private repo, e.g. `moonkengi/lipakit-releases`, holding tagged releases. Set `LIPAKIT_DELIVERY_REPO=moonkengi/lipakit-releases` in your shell and `gh auth login`.

### Each sale

When Paystack emails you a successful payment:

```bash
node scripts/release/issue.mjs --email buyer@example.com --name "Buyer Name" --tier solo [--github their-username]
```

It signs a licence key, exports the current release with `git archive` (seller files excluded), stamps the licence ID into `LICENSE.md` and a few code markers, zips it to `dist/lipakit-LK-XXXXXX.zip`, records the sale in `~/.lipakit/licences.csv`, and with `--github` invites the buyer to the delivery repo (read access).

Then email the buyer:

- the zip (or a Google Drive / Dropbox link if it's too large to attach),
- their licence ID, tier and update window,
- the support address and a pointer to `README.md`.

Release from a clean, tagged commit (`git tag v1.0.0`), so every buyer of that version gets the same code.

### Renewals

Sell update renewals through the same Paystack pages. Reissue with `--months 12`; the new key carries the new `updatesUntil`.

### Leaks

If a copy turns up somewhere it shouldn't: `node scripts/release/trace.mjs <folder>` reads the licence markers and looks them up in your ledger. The licence allows termination for breach; remove the buyer from the delivery repo. Treat watermarks as a deterrent, not protection: a determined person can strip them.

## Later: your own Till or Paybill

Once you register a business name (or get a Till as an individual via m-pesaforbusiness.co.ke):

1. Get the shortcode and go live on Daraja ([03](03-mpesa-go-live.md)).
2. Run LipaKit itself as the store: one-time plans (Lite, Solo, Agency) on your own deployment. This proves the kit on real money, and the receipts are your sales records.
3. Hook delivery to payment: call `issue.mjs` (or a small server version of it) when an order is paid, and email the zip link automatically.
4. Keep Paystack for card buyers abroad if they become a real share of sales.

## Pricing reference

| Tier   | Price | Use                                                         | Updates   | Renewal |
| ------ | ----- | ----------------------------------------------------------- | --------- | ------- |
| Lite   | $49   | 1 product, 1 person, no client work                         | 6 months  | $29/yr  |
| Solo   | $99   | Unlimited own products, 1 person                            | 12 months | $49/yr  |
| Agency | $299  | Unlimited incl. client work and white-label, up to 5 people | 12 months | $149/yr |
