# 01 · Setup

This gets you from a fresh download to a running app with the M-Pesa simulator. No Safaricom account needed yet.

## What you need

- Node.js 20 or newer, and pnpm (`npm install -g pnpm`)
- A free [Supabase](https://supabase.com) account

## 1. Install

```bash
pnpm install
cp .env.example .env.local
```

## 2. Create the Supabase project

1. In Supabase, create a new project. Pick the region closest to your users (for Kenya, an EU or South Africa region usually has the lowest latency; check what Supabase offers).
2. Open **SQL Editor**, paste the whole of `supabase/setup.sql`, and run it. This creates every table, security policy and function, plus three demo plans.
   - Using the Supabase CLI instead? `supabase link --project-ref <ref>` then `supabase db push` runs the same migrations.
3. Open **Project Settings → API** and copy into `.env.local`:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (secret: never expose it to the browser or commit it)

## 3. Fill in the rest of `.env.local`

Only these are required to start:

| Variable               | Value                                                |
| ---------------------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000`                              |
| `MPESA_MODE`           | `simulator`                                          |
| `MPESA_CALLBACK_TOKEN` | Output of `openssl rand -hex 24`                     |
| `CRON_SECRET`          | Output of `openssl rand -hex 24` (a different value) |

Everything else (SMS, email, Telegram, Slack, push, B2C) is optional; each feature turns on when its keys are set. `.env.example` explains every variable.

The app validates the environment when it starts. If something is wrong, it tells you which variable and why, before anything else runs.

## 4. Sign-in settings

In Supabase → **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000`
- **Redirect URLs**: add `http://localhost:3000/auth/callback`

Email magic links work straight away using Supabase's built-in email, which is rate-limited (a few emails per hour). For real use, add your own SMTP under **Authentication → SMTP Settings**.

### Google sign-in (optional)

1. Create an OAuth client in Google Cloud Console (type: web application).
2. Authorised redirect URI: the callback URL Supabase shows under **Authentication → Providers → Google**.
3. Paste the client ID and secret into that Supabase page and enable it.

To hide the Google button, set `googleAuth: false` in `src/config/features.ts`.

### Phone sign-in with SMS codes (optional)

Supabase has no built-in Africa's Talking provider, so the kit plugs in through Supabase's **Send SMS hook**:

1. Set `AT_USERNAME`, `AT_API_KEY` (and `AT_SENDER_ID` if you have one) from your Africa's Talking account.
2. Supabase → **Authentication → Providers → Phone**: enable it.
3. Supabase → **Authentication → Hooks → Send SMS hook**: choose HTTPS, URL `https://<your-app>/api/auth/sms-hook`, and copy the generated secret into `SUPABASE_SMS_HOOK_SECRET`.
4. Set `phoneOtp: true` in `src/config/features.ts`.

The hook URL must be public, so this works once you've deployed (or through a tunnel; see [02](02-mpesa-sandbox.md)).

## 5. Run it

```bash
pnpm dev
```

Open http://localhost:3000, sign in with your email, and you land on the dashboard.

## 6. Make yourself an admin

In the SQL editor:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

Refresh; `/admin` is now available. Want something to look at? `pnpm demo:data` adds demo customers, payments, a trial, an overdue plan, an unmatched payment and an order needing review (simulator mode only).

## 7. Check everything

```bash
pnpm run doctor
```

It checks your env file, then asks the running app to check the database, storage, scheduler and channels. (Note `run`: plain `pnpm doctor` is a different, built-in pnpm command.) The same checks are on the admin **Health** page.

Next: pay for a plan with the simulator (README), then [02 · M-Pesa sandbox](02-mpesa-sandbox.md).
