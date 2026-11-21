/**
 * Health checks: the first thing to look at when "payments aren't working".
 * Used by the admin Health page and by `pnpm run doctor` (through /api/cron/doctor).
 *
 * The rules (what counts as stale, what's a warning) are pure functions at the
 * bottom so they're unit tested; runHealthChecks() gathers the facts.
 */
import "server-only";
import { configuredAlertChannels } from "@/lib/alerts";
import { getServerEnv } from "@/lib/env";
import { createTokenProvider } from "@/lib/mpesa/auth";
import { findBannedKeyword } from "@/lib/mpesa/c2b";
import { DARAJA_BASE_URLS } from "@/lib/mpesa/http";
import { getNotifier } from "@/lib/notify";
import { pushEnabled } from "@/lib/notify/push";
import { b2cEnabled, callbackUrl } from "@/lib/payments/mpesa-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramConfigured } from "@/lib/telegram";

export type CheckStatus = "ok" | "warn" | "fail" | "info";
export type Check = { id: string; group: string; label: string; status: CheckStatus; detail: string };

const MIN = 60_000;
const HOUR = 60 * MIN;

function ago(ms: number): string {
  if (ms < MIN) return "just now";
  if (ms < HOUR) return `${Math.round(ms / MIN)} min ago`;
  if (ms < 48 * HOUR) return `${Math.round(ms / HOUR)} h ago`;
  return `${Math.round(ms / (24 * HOUR))} days ago`;
}

// --- Pure rules -------------------------------------------------------------------

export function checkJob(
  job: string,
  lastRunAt: Date | null,
  lastOk: boolean | null,
  now: Date,
  expectEveryMs: number,
): Check {
  const label = job === "mpesa-poll" ? "Status poller (every minute)" : "Renewals job (daily)";
  if (!lastRunAt) {
    return {
      id: `job:${job}`,
      group: "Scheduler",
      label,
      status: "fail",
      detail: "Never ran. Run lipakit_schedule_jobs() in the Supabase SQL editor (README step 4).",
    };
  }
  const age = now.getTime() - lastRunAt.getTime();
  if (age > expectEveryMs * 3) {
    return {
      id: `job:${job}`,
      group: "Scheduler",
      label,
      status: "fail",
      detail: `Last ran ${ago(age)}. The scheduler looks stopped.`,
    };
  }
  if (lastOk === false) {
    return {
      id: `job:${job}`,
      group: "Scheduler",
      label,
      status: "warn",
      detail: `Last run (${ago(age)}) failed. See job_runs.summary.`,
    };
  }
  return { id: `job:${job}`, group: "Scheduler", label, status: "ok", detail: `Last ran ${ago(age)}.` };
}

export function checkOldestPending(oldest: Date | null, now: Date): Check {
  const base = { id: "stk:oldest-pending", group: "Payments", label: "Pending STK pushes" };
  if (!oldest) return { ...base, status: "ok", detail: "None waiting." };
  const age = now.getTime() - oldest.getTime();
  // The poller expires pushes at 10 minutes; older than ~12 means it isn't running.
  if (age > 12 * MIN)
    return { ...base, status: "fail", detail: `Oldest has waited ${ago(age)}. The poller isn't clearing them.` };
  return { ...base, status: "ok", detail: `Oldest is ${ago(age)} old.` };
}

export function checkCount(id: string, label: string, count: number, link: string, warnAbove = 0): Check {
  return {
    id,
    group: "Needs attention",
    label,
    status: count > warnAbove ? "warn" : "ok",
    detail: count === 0 ? "None." : `${count} waiting. Open ${link}.`,
  };
}

export function checkLastCallback(kind: string, at: Date | null, now: Date, expected: boolean): Check {
  const base = { id: `callback:${kind}`, group: "Callbacks", label: `Last ${kind.replace("_", " ")} callback` };
  if (!at) return { ...base, status: expected ? "warn" : "info", detail: "None received yet." };
  return { ...base, status: "info", detail: ago(now.getTime() - at.getTime()) };
}

// --- Gather facts and run -----------------------------------------------------------

export async function runHealthChecks(now = new Date()): Promise<Check[]> {
  const env = getServerEnv();
  const checks: Check[] = [];
  const db = createAdminClient();

  // Configuration
  checks.push({
    id: "config:mode",
    group: "Configuration",
    label: "M-Pesa mode",
    status: env.MPESA_MODE === "simulator" && env.VERCEL_ENV ? "warn" : "info",
    detail:
      env.MPESA_MODE === "simulator"
        ? "Simulator: no real payments. Switch to sandbox or production before launch."
        : `${env.MPESA_MODE}, shortcode ${env.MPESA_SHORTCODE ?? "?"} (${env.MPESA_TILL_OR_PAYBILL}).`,
  });
  const cbUrl = callbackUrl("stk");
  const banned = findBannedKeyword(cbUrl);
  checks.push({
    id: "config:callback-url",
    group: "Configuration",
    label: "Callback URLs",
    status: banned || (env.MPESA_MODE !== "simulator" && !cbUrl.startsWith("https://")) ? "fail" : "ok",
    detail: banned
      ? `Contains "${banned}", which Safaricom blocks. Change NEXT_PUBLIC_SITE_URL's domain.`
      : !cbUrl.startsWith("https://") && env.MPESA_MODE !== "simulator"
        ? "Daraja needs a public https:// URL. Set NEXT_PUBLIC_SITE_URL."
        : `${env.NEXT_PUBLIC_SITE_URL}/api/hooks/•••/…`,
  });

  // Daraja credentials
  if (env.MPESA_MODE !== "simulator") {
    try {
      await createTokenProvider({
        baseUrl: DARAJA_BASE_URLS[env.MPESA_MODE],
        consumerKey: env.MPESA_CONSUMER_KEY!,
        consumerSecret: env.MPESA_CONSUMER_SECRET!,
        timeoutMs: 10_000,
        fetch,
        now: () => new Date(),
      }).getToken();
      checks.push({
        id: "daraja:auth",
        group: "Configuration",
        label: "Daraja credentials",
        status: "ok",
        detail: "OAuth token issued.",
      });
    } catch (e) {
      checks.push({
        id: "daraja:auth",
        group: "Configuration",
        label: "Daraja credentials",
        status: "fail",
        detail: (e as Error).message,
      });
    }
  }

  // Database
  const { error: dbError } = await db.from("plans").select("id", { head: true, count: "exact" });
  checks.push({
    id: "db",
    group: "Configuration",
    label: "Database",
    status: dbError ? "fail" : "ok",
    detail: dbError ? dbError.message : "Reachable with the service role key.",
  });
  if (dbError) return checks;

  const { data: buckets } = await db.storage.listBuckets();
  checks.push({
    id: "storage:receipts",
    group: "Configuration",
    label: "Receipts storage bucket",
    status: buckets?.some((b) => b.name === "receipts") ? "ok" : "fail",
    detail: buckets?.some((b) => b.name === "receipts")
      ? "Present."
      : "Missing. Apply migration 20261121000005_billing.sql.",
  });

  // Scheduler
  for (const [job, every] of [
    ["mpesa-poll", MIN],
    ["renewals", 24 * HOUR],
  ] as const) {
    const { data } = await db
      .from("job_runs")
      .select("created_at, ok")
      .eq("job", job)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    checks.push(checkJob(job, data ? new Date(data.created_at) : null, data?.ok ?? null, now, every));
  }

  // Payments
  const { data: oldest } = await db
    .from("mpesa_transactions")
    .select("created_at")
    .eq("kind", "stk")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  checks.push(checkOldestPending(oldest ? new Date(oldest.created_at) : null, now));

  const since24h = new Date(now.getTime() - 24 * HOUR).toISOString();
  const [unmatched, review, failedCallbacks] = await Promise.all([
    db.from("mpesa_transactions").select("id", { head: true, count: "exact" }).eq("status", "unmatched"),
    db.from("orders").select("id", { head: true, count: "exact" }).eq("status", "needs_review"),
    db
      .from("mpesa_callbacks")
      .select("id", { head: true, count: "exact" })
      .not("error", "is", null)
      .gte("received_at", since24h)
      .not("error", "like", "unmatched:%")
      .not("error", "like", "duplicate:%"),
  ]);
  checks.push(checkCount("queue:unmatched", "Unmatched payments", unmatched.count ?? 0, "Unmatched"));
  checks.push(checkCount("queue:review", "Orders needing review", review.count ?? 0, "Needs review"));
  checks.push(
    checkCount("callbacks:failed", "Callbacks that failed (24 h)", failedCallbacks.count ?? 0, "Callback log"),
  );

  for (const kind of ["stk", "c2b_confirm"] as const) {
    const { data } = await db
      .from("mpesa_callbacks")
      .select("received_at")
      .eq("kind", kind)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    checks.push(
      checkLastCallback(
        kind,
        data ? new Date(data.received_at) : null,
        now,
        kind === "stk" && env.MPESA_MODE !== "simulator",
      ),
    );
  }

  // Channels
  const n = getNotifier();
  const alertNames = configuredAlertChannels().map((c) => c.name);
  checks.push({
    id: "channels:customer",
    group: "Notifications",
    label: "Customer messages",
    status: n.sms || n.email ? "ok" : "warn",
    detail:
      [n.sms && "SMS", n.email && "email", n.telegram && "Telegram", pushEnabled() && "web push"]
        .filter(Boolean)
        .join(", ") || "None configured: customers won't get receipts or renewal reminders.",
  });
  checks.push({
    id: "channels:admin",
    group: "Notifications",
    label: "Admin alerts",
    status: alertNames.length ? "ok" : "warn",
    detail: alertNames.length
      ? alertNames.join(", ")
      : "None configured: you won't hear about failed callbacks or unmatched payments.",
  });
  checks.push({
    id: "channels:telegram-linking",
    group: "Notifications",
    label: "Telegram account linking",
    status: "info",
    detail: telegramConfigured()
      ? "On."
      : "Off (set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and TELEGRAM_BOT_USERNAME).",
  });
  checks.push({
    id: "b2c",
    group: "Configuration",
    label: "B2C payouts",
    status: "info",
    detail: b2cEnabled() ? `On. Daily limit KES ${env.B2C_DAILY_LIMIT_KES.toLocaleString("en-KE")}.` : "Off.",
  });

  return checks;
}
