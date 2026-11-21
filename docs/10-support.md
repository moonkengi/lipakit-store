# 10 · Support

## Before asking

Most problems are configuration, and these find them fastest:

1. `pnpm run doctor` (or the admin **Health** page). Fix anything red.
2. [06 · Troubleshooting](06-troubleshooting.md), and [08 · Failure modes](08-failure-modes.md) for payment behaviour.
3. The callback log (`/admin/callbacks`): it holds every raw Daraja payload and any processing error.

## What's covered

- Bugs in the kit's code.
- Questions about setting up, deploying and configuring the kit as documented.
- Clarifying how a part of the kit works.

## What isn't

- Code you've changed or added (we'll help where we can, but no promises).
- Safaricom account, shortcode and approval issues: those go to Safaricom (apisupport@safaricom.co.ke for Daraja, Safaricom business care for shortcodes).
- General consulting or building features for you. Go-live help is available as a separate paid service.

## How to report a problem

Open an issue on the delivery repository (or email the support address you received with your licence). Include:

1. **What you did, what you expected, what happened.**
2. **`pnpm run doctor` output** (it never prints secrets).
3. **The callback log row** for the payment, if it's about one: kind, error, and the payload with phone numbers masked.
4. **Mode** (`simulator`, `sandbox` or `production`) and kit version (`CHANGELOG.md`).
5. Your **licence ID** (in `LICENSE.md`).

**Never send** your service role key, consumer secret, passkey, B2C security credential, `CRON_SECRET` or callback token. Nobody needs them to help you.

Agency licences get a faster response.
