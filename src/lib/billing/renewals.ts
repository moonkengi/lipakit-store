/**
 * The renewal planner: given today's subscriptions, what should happen?
 *
 * M-Pesa can't be charged like a card, so renewal is a conversation:
 *   3 days before the period ends → create a renewal bill and remind the customer
 *   period ends unpaid            → grace for GRACE_DAYS (still has access)
 *   grace ends unpaid             → expired
 * Trials don't get grace: an unpaid trial expires at its end.
 * Ratiba (standing order) subscriptions get no reminder; if the period ends
 * unpaid, they fall back to manual renewal with a bill and a message.
 *
 * Pure and idempotent: running it twice on the same day plans nothing new,
 * because a sub that already has an open bill or has already moved to grace
 * doesn't match the same rule again. The executor is in ./renewals-runner.ts.
 */
import type { SubscriptionStatus } from "@/lib/supabase/database.types";

export const REMINDER_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RenewalSub = {
  id: string;
  status: Extract<SubscriptionStatus, "trialing" | "active" | "grace">;
  periodEnd: Date;
  graceUntil: Date | null;
  cancelAtPeriodEnd: boolean;
  renewalMethod: "manual" | "ratiba";
  /** A pending renewal order (bill) already exists for this subscription. */
  hasOpenBill: boolean;
};

export type BillReason = "reminder" | "grace" | "ratiba_fallback";

export type RenewalAction =
  | { type: "create_bill"; subscriptionId: string; reason: BillReason }
  | { type: "start_grace"; subscriptionId: string; graceUntil: Date; switchToManual: boolean }
  | { type: "expire"; subscriptionId: string; reason: "trial_ended" | "grace_ended" | "no_grace" }
  | { type: "cancel"; subscriptionId: string };

export function planRenewals(
  subs: RenewalSub[],
  now: Date,
  opts: { graceDays: number; reminderDays?: number },
): RenewalAction[] {
  const reminderMs = (opts.reminderDays ?? REMINDER_DAYS) * DAY_MS;
  const actions: RenewalAction[] = [];
  const t = now.getTime();

  for (const sub of subs) {
    const ended = sub.periodEnd.getTime() <= t;
    const dueSoon = !ended && sub.periodEnd.getTime() - t <= reminderMs;

    if (sub.status === "grace") {
      if (sub.graceUntil && sub.graceUntil.getTime() <= t) {
        actions.push({ type: "expire", subscriptionId: sub.id, reason: "grace_ended" });
      } else if (!sub.hasOpenBill) {
        // Safety net: someone in grace should always have something to pay.
        actions.push({ type: "create_bill", subscriptionId: sub.id, reason: "grace" });
      }
      continue;
    }

    if (ended) {
      if (sub.cancelAtPeriodEnd) {
        actions.push({ type: "cancel", subscriptionId: sub.id });
      } else if (sub.status === "trialing") {
        actions.push({ type: "expire", subscriptionId: sub.id, reason: "trial_ended" });
      } else if (opts.graceDays <= 0) {
        actions.push({ type: "expire", subscriptionId: sub.id, reason: "no_grace" });
      } else {
        actions.push({
          type: "start_grace",
          subscriptionId: sub.id,
          graceUntil: new Date(sub.periodEnd.getTime() + opts.graceDays * DAY_MS),
          switchToManual: sub.renewalMethod === "ratiba",
        });
        if (!sub.hasOpenBill) {
          actions.push({
            type: "create_bill",
            subscriptionId: sub.id,
            reason: sub.renewalMethod === "ratiba" ? "ratiba_fallback" : "grace",
          });
        }
      }
      continue;
    }

    if (dueSoon && !sub.cancelAtPeriodEnd && sub.renewalMethod === "manual" && !sub.hasOpenBill) {
      actions.push({ type: "create_bill", subscriptionId: sub.id, reason: "reminder" });
    }
  }
  return actions;
}
