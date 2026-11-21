#!/usr/bin/env node
/**
 * pnpm run doctor: check a LipaKit setup end to end.
 *
 *   (Use "pnpm run doctor": plain "pnpm doctor" is a built-in pnpm command.)
 *
 *   pnpm run doctor                 uses .env.local and asks your running app (NEXT_PUBLIC_SITE_URL)
 *   pnpm run doctor --env .env.prod --url https://your-app.vercel.app
 *
 * 1. Local checks on the env file (no network): required values, formats.
 * 2. Server checks from the running app (/api/cron/doctor): database, storage,
 *    scheduler, Daraja credentials, queues, notification channels.
 * Plain Node, no dependencies, so it still works when the app itself won't start.
 */
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const envFile = flag("--env") ?? ".env.local";

const colour = { ok: "\x1b[32m✓\x1b[0m", warn: "\x1b[33m!\x1b[0m", fail: "\x1b[31m✗\x1b[0m", info: "\x1b[36mi\x1b[0m" };
let failures = 0;
const report = (status, label, detail) => {
  if (status === "fail") failures++;
  console.log(`  ${colour[status]} ${label}${detail ? `: ${detail}` : ""}`);
};

console.log(`\nLipaKit doctor\n`);
console.log(`Environment file: ${envFile}`);
if (!existsSync(envFile)) {
  report("fail", envFile, "not found. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}
process.loadEnvFile(envFile);
const env = process.env;

const BANNED = ["m-pesa", "mpesa", "safaricom", "exe", "exec", "cmd", "sql", "query"];
const required = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MPESA_CALLBACK_TOKEN",
  "CRON_SECRET",
];
for (const key of required) {
  const v = env[key];
  if (!v || v.includes("your-") || v.startsWith("replace-with"))
    report("fail", key, "missing or still the placeholder");
  else report("ok", key);
}
const mode = env.MPESA_MODE ?? "simulator";
report("info", "MPESA_MODE", mode);
if (mode !== "simulator") {
  for (const key of ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY"]) {
    report(env[key] ? "ok" : "fail", key, env[key] ? "" : `required when MPESA_MODE=${mode}`);
  }
  if (!env.NEXT_PUBLIC_SITE_URL?.startsWith("https://"))
    report("fail", "NEXT_PUBLIC_SITE_URL", "Daraja needs a public https:// URL");
}
const token = env.MPESA_CALLBACK_TOKEN ?? "";
const bad = BANNED.find(
  (w) => (env.NEXT_PUBLIC_SITE_URL ?? "").toLowerCase().includes(w) || token.toLowerCase().includes(w),
);
if (bad) report("fail", "Callback URL", `contains "${bad}", which Safaricom blocks`);

const url = (flag("--url") ?? env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
console.log(`\nRunning app: ${url}`);
try {
  const res = await fetch(`${url}/api/cron/doctor`, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) report("fail", "App", "rejected CRON_SECRET. Is the app using the same env?");
  else if (!res.ok) report("fail", "App", `answered HTTP ${res.status}`);
  else {
    const { checks } = await res.json();
    let group = "";
    for (const c of checks) {
      if (c.group !== group) console.log(`\n${(group = c.group)}`);
      report(c.status, c.label, c.detail);
    }
  }
} catch (e) {
  report("fail", "App", `not reachable (${e.cause?.code ?? e.message}). Start it with pnpm dev, or pass --url.`);
}

console.log(failures ? `\n${failures} problem(s) found.\n` : "\nAll good.\n");
process.exit(failures ? 1 : 0);
