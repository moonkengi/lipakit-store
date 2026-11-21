# 03 · Going live with M-Pesa

Going live means two things: owning a Safaricom **shortcode** (a Paybill or a Till) and getting **production Daraja credentials** for it. Requirements change from time to time, so check Safaricom's current documents; anything below marked _confirm with Safaricom_ is common practice we couldn't verify.

## Step 1: Get a shortcode

You can't go live without one. Which one?

|                                    | Till (Buy Goods)                         | Paybill                                       |
| ---------------------------------- | ---------------------------------------- | --------------------------------------------- |
| Customers pay to                   | A till number                            | A business number + account number            |
| Account numbers (for C2B matching) | No                                       | Yes                                           |
| Who can apply                      | Individuals, sole proprietors, companies | Registered businesses                         |
| Typical turnaround                 | A day or two                             | One to three weeks _(confirm with Safaricom)_ |

For a SaaS, a **Paybill** is the better fit: customers can pay from the M-Pesa menu with the account number the kit sends them, and C2B matching uses it. A **Till** works for STK push (the kit handles both; set `MPESA_TILL_OR_PAYBILL` and, if the till number differs from the store number, `MPESA_TILL_NUMBER`).

**Applying:**

- **Till:** Safaricom's self-onboarding portal, [m-pesaforbusiness.co.ke](https://m-pesaforbusiness.co.ke). Choose Business Till (Buy Goods) and your business type (individual, sole proprietor or company). The till and store numbers arrive by SMS.
- **Paybill:** the application form and KYC documents from Safaricom's Lipa na M-Pesa pages, submitted online or at a Safaricom shop. Expect company registration documents, a KRA PIN and settlement bank details.

**Common reasons for delays and rejections** _(confirm with Safaricom)_:

- Names that don't match across the registration certificate, KRA PIN and bank account.
- The managing Safaricom line registered to someone other than the owner.
- Missing or expired documents.

**No shortcode yet?** Develop with the simulator and the sandbox. To take real payments before your shortcode arrives, run them through Paystack ([11](11-paystack.md)) and switch over later.

## Step 2: Get a business administrator

Safaricom creates a **Business Administrator** (or Business Manager) user on the M-Pesa organisation portal for your shortcode. Going live on Daraja asks for this username and sends a one-time code to its phone. Make sure you know who holds it.

## Step 3: Go live on Daraja

1. Sign in to [developer.safaricom.co.ke](https://developer.safaricom.co.ke) and open **Go Live**.
2. Choose verification by **shortcode**, enter your Paybill or Till (or head office/store number for a till) and your organisation name, and select only the APIs you use.
3. Confirm with the one-time code sent to the business administrator.
4. You receive production credentials: consumer key and secret for a new production app, and the **production passkey** for STK push (often by email to the registered address).

Daraja 3.0 moved go-live to self-service, so this is usually quick once the shortcode and administrator are in place. Some setups still need extra documents or a go-live request letter _(confirm with Safaricom)_.

**B2C payouts** need their own B2C shortcode (often different from your Paybill), an **initiator** user, and its **security credential**: the initiator password encrypted with Safaricom's production certificate. Generate it in the Daraja portal. Set `MPESA_B2C_SHORTCODE`, `MPESA_B2C_INITIATOR` and `MPESA_B2C_SECURITY_CREDENTIAL`.

## Step 4: Switch the app to production

```bash
MPESA_MODE=production
MPESA_CONSUMER_KEY=...        # production app
MPESA_CONSUMER_SECRET=...
MPESA_SHORTCODE=...           # your Paybill, or the store/HO number for a till
MPESA_PASSKEY=...             # production passkey
MPESA_TILL_OR_PAYBILL=paybill # or till
NEXT_PUBLIC_SITE_URL=https://your-domain.co.ke
```

Then:

1. Deploy, and run `pnpm run doctor --url https://your-domain.co.ke`. Fix anything red.
2. `/admin/integrations` → **Register C2B URLs**. In production you may only be able to register once per shortcode; changing URLs later can need Safaricom support _(confirm with Safaricom)_. So register **after** your domain is final.
3. Make a small real payment (KES 1–10) and watch it go through `/admin/orders`.

## Step 5: Before you announce it

- [ ] Real callback URL on your final domain, https, no blocked words
- [ ] Scheduled jobs running (Health page shows the poller's last run)
- [ ] SMS or email configured, so customers get receipts and reminders
- [ ] At least one admin alert channel, so you hear about failed callbacks
- [ ] Terms and privacy pages written (Kenya's Data Protection Act 2019 applies: you're processing phone numbers and payment data)
- [ ] Optional hardening: allowlist Safaricom's callback IP addresses at your CDN or firewall. The list changes, so get the current one from Safaricom.
