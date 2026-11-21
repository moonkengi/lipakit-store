/**
 * Executes the renewal plan from ./renewals.ts against the database and sends
 * the messages. Every update is guarded by the status it expects, so a re-run
 * (or two overlapping runs) can't double-apply anything.
 */
import "server-only";
import { siteConfig } from "@/config/site";
import { getServerEnv } from "@/lib/env";
import { notifyRecipient } from "@/lib/notify";
import {
  graceStarted,
  ratibaFallback,
  renewalReminder,
  subscriptionExpired,
  type PayInstructions,
} from "@/lib/notify/messages";
import { generateAccountRef } from "@/lib/payments/checkout";
import { mpesaConfigFromEnv } from "@/lib/payments/mpesa-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { LIVE_STATUSES } from "./entitlements";
import { planRenewals, type RenewalAction, type RenewalSub } from "./renewals";

export type RenewalRunSummary = { checked: number; actions: Record<RenewalAction["type"], number>; errors: number };

type SubRow = {
  id: string;
  user_id: string;
  status: RenewalSub["status"];
  current_period_end: string;
  grace_until: string | null;
  cancel_at_period_end: boolean;
  renewal_method: "manual" | "ratiba";
  plan_id: string;
  plans: { name: string; price_kes: number } | null;
  profiles: { email: string | null; phone: string | null; telegram_chat_id: number | null } | null;
};

export async function runRenewals(now = new Date()): Promise<RenewalRunSummary> {
  const db = createAdminClient();
  const env = getServerEnv();

  const { data: subs, error } = await db
    .from("subscriptions")
    .select(
      "id, user_id, status, current_period_end, grace_until, cancel_at_period_end, renewal_method, plan_id, plans(name, price_kes), profiles(email, phone, telegram_chat_id)",
    )
    .in("status", [...LIVE_STATUSES]);
  if (error) throw new Error(`runRenewals: ${error.message}`);
  const rows = subs as unknown as SubRow[];

  const { data: bills } = await db
    .from("orders")
    .select("id, subscription_id, account_ref")
    .eq("purpose", "renewal")
    .eq("status", "pending")
    .in(
      "subscription_id",
      rows.map((s) => s.id).length ? rows.map((s) => s.id) : ["00000000-0000-0000-0000-000000000000"],
    );
  const openBill = new Map((bills ?? []).map((b) => [b.subscription_id, b]));

  const plan = planRenewals(
    rows.map((s) => ({
      id: s.id,
      status: s.status,
      periodEnd: new Date(s.current_period_end),
      graceUntil: s.grace_until ? new Date(s.grace_until) : null,
      cancelAtPeriodEnd: s.cancel_at_period_end,
      renewalMethod: s.renewal_method,
      hasOpenBill: openBill.has(s.id),
    })),
    now,
    { graceDays: env.GRACE_DAYS },
  );

  const summary: RenewalRunSummary = {
    checked: rows.length,
    actions: { create_bill: 0, start_grace: 0, expire: 0, cancel: 0 },
    errors: 0,
  };
  const byId = new Map(rows.map((s) => [s.id, s]));
  const billingLink = `${env.NEXT_PUBLIC_SITE_URL}/dashboard/billing`;
  const mpesa = mpesaConfigFromEnv();
  const pay = (accountRef: string): PayInstructions => ({
    link: billingLink,
    paybill: mpesa.transactionType === "CustomerPayBillOnline" ? { shortcode: mpesa.partyB, accountRef } : undefined,
  });

  for (const action of plan) {
    const sub = byId.get(action.subscriptionId);
    if (!sub?.plans) continue;
    const to = {
      email: sub.profiles?.email,
      phone: sub.profiles?.phone,
      telegramChatId: sub.profiles?.telegram_chat_id,
    };
    try {
      switch (action.type) {
        case "create_bill": {
          const { data: order, error: insertError } = await db
            .from("orders")
            .insert({
              user_id: sub.user_id,
              subscription_id: sub.id,
              plan_id: sub.plan_id,
              purpose: "renewal",
              amount_kes: sub.plans.price_kes,
              account_ref: generateAccountRef(),
            })
            .select("account_ref")
            .single();
          if (insertError || !order) throw new Error(insertError?.message ?? "bill not created");
          openBill.set(sub.id, { id: "", subscription_id: sub.id, account_ref: order.account_ref });
          const common = {
            product: siteConfig.name,
            planName: sub.plans.name,
            amountKes: sub.plans.price_kes,
            pay: pay(order.account_ref),
          };
          const graceUntil = sub.grace_until
            ? new Date(sub.grace_until)
            : new Date(new Date(sub.current_period_end).getTime() + env.GRACE_DAYS * 86_400_000);
          const message =
            action.reason === "reminder"
              ? renewalReminder({ ...common, dueDate: new Date(sub.current_period_end) })
              : action.reason === "ratiba_fallback"
                ? ratibaFallback(common)
                : graceStarted({ ...common, graceUntil });
          await notifyRecipient(to, message);
          break;
        }
        case "start_grace": {
          await db
            .from("subscriptions")
            .update({
              status: "grace",
              grace_until: action.graceUntil.toISOString(),
              ...(action.switchToManual ? { renewal_method: "manual" as const, ratiba_status: "failed" as const } : {}),
            })
            .eq("id", sub.id)
            .eq("status", "active");
          sub.grace_until = action.graceUntil.toISOString();
          break;
        }
        case "expire":
        case "cancel": {
          const { data: changed } = await db
            .from("subscriptions")
            .update({ status: action.type === "expire" ? "expired" : "canceled" })
            .eq("id", sub.id)
            .in("status", [...LIVE_STATUSES])
            .select("id");
          if (!changed?.length) break;
          await db
            .from("orders")
            .update({ status: "cancelled", status_reason: "Subscription ended before this bill was paid." })
            .eq("subscription_id", sub.id)
            .eq("purpose", "renewal")
            .eq("status", "pending");
          if (action.type === "expire") {
            await notifyRecipient(
              to,
              subscriptionExpired({
                product: siteConfig.name,
                planName: sub.plans.name,
                link: `${env.NEXT_PUBLIC_SITE_URL}/pricing`,
              }),
            );
          }
          break;
        }
      }
      summary.actions[action.type]++;
    } catch (e) {
      summary.errors++;
      console.error("[renewals]", action.type, "failed for subscription", sub.id, e);
    }
  }
  return summary;
}
