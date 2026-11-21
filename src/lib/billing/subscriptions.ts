/**
 * Subscription changes a user can make themselves: start a trial, cancel at
 * period end (or undo it), and switch auto-renew via M-Pesa Ratiba on or off.
 * Money-driven changes (activate, extend) only ever happen in the database's
 * billing_apply_paid_order().
 */
import "server-only";
import { siteConfig } from "@/config/site";
import { getServerEnv } from "@/lib/env";
import { MpesaError, type RatibaFrequency } from "@/lib/mpesa";
import { callbackUrl, getMpesaClient } from "@/lib/payments/mpesa-client";
import { generateAccountRef } from "@/lib/payments/checkout";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanInterval } from "@/lib/supabase/database.types";
import { LIVE_STATUSES } from "./entitlements";

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start a free trial. Only for plans with trial_days, and only for users who've never had a subscription. */
export async function startTrial(userId: string, planCode: string): Promise<void> {
  const db = createAdminClient();
  const { data: plan } = await db
    .from("plans")
    .select("id, trial_days")
    .eq("code", planCode)
    .eq("is_active", true)
    .maybeSingle();
  if (!plan || plan.trial_days <= 0) throw new BillingError("That plan doesn't have a free trial.");

  const { count } = await db.from("subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if ((count ?? 0) > 0) throw new BillingError("Free trials are for new accounts. Choose a plan to continue.");

  const now = new Date();
  const { error } = await db.from("subscriptions").insert({
    user_id: userId,
    plan_id: plan.id,
    status: "trialing",
    current_period_start: now.toISOString(),
    current_period_end: new Date(now.getTime() + plan.trial_days * DAY_MS).toISOString(),
  });
  // 23505: the one-live-subscription index caught a double click.
  if (error && error.code !== "23505") throw new BillingError("We couldn't start your trial. Please try again.");
}

async function liveSubscription(userId: string) {
  const { data } = await createAdminClient()
    .from("subscriptions")
    .select("id, status, plan_id, current_period_end, renewal_method, ratiba_account_ref, ratiba_status")
    .eq("user_id", userId)
    .in("status", [...LIVE_STATUSES])
    .maybeSingle();
  return data;
}

export async function setCancelAtPeriodEnd(userId: string, cancel: boolean): Promise<void> {
  const sub = await liveSubscription(userId);
  if (!sub) throw new BillingError("You don't have an active plan.");
  await createAdminClient().from("subscriptions").update({ cancel_at_period_end: cancel }).eq("id", sub.id);
}

const ratibaFrequency: Record<PlanInterval, RatibaFrequency> = {
  month: "monthly",
  quarter: "quarterly",
  year: "yearly",
};

/**
 * Ask the customer to approve a standing order. They get a prompt on their
 * phone; when Ratiba's callback confirms, renewal_method becomes "ratiba".
 */
export async function requestRatiba(userId: string, phone: string): Promise<void> {
  if (!getServerEnv().MPESA_RATIBA_ENABLED) throw new BillingError("Automatic M-Pesa renewal isn't available.");
  const sub = await liveSubscription(userId);
  if (!sub) throw new BillingError("You need an active plan first.");
  if (sub.ratiba_status === "active" || sub.ratiba_status === "requested") {
    throw new BillingError("Automatic renewal is already set up or waiting for your approval.");
  }

  const db = createAdminClient();
  const { data: plan } = await db.from("plans").select("name, price_kes, interval").eq("id", sub.plan_id).single();
  if (!plan) throw new BillingError("Plan not found.");

  const accountRef = sub.ratiba_account_ref ?? generateAccountRef(`${siteConfig.receiptPrefix}S`);
  const start = new Date(sub.current_period_end);
  const end = new Date(start.getTime() + 5 * 365 * DAY_MS);

  try {
    const res = await getMpesaClient().createStandingOrder({
      name: `${siteConfig.name} ${plan.name} ${accountRef}`,
      phone,
      amountKes: plan.price_kes,
      startDate: start,
      endDate: end,
      frequency: ratibaFrequency[plan.interval],
      accountReference: accountRef,
      description: siteConfig.name,
      callbackUrl: callbackUrl("ratiba"),
    });
    await db
      .from("subscriptions")
      .update({ ratiba_account_ref: accountRef, ratiba_status: "requested" })
      .eq("id", sub.id);
    // Remember the request so the callback can find the subscription.
    await db.from("mpesa_transactions").insert({
      kind: "ratiba",
      merchant_request_id: res.requestRefId,
      account_ref: accountRef,
      amount_kes: plan.price_kes,
      raw: res.raw as never,
    });
  } catch (error) {
    throw new BillingError(error instanceof MpesaError ? error.message : "We couldn't reach M-Pesa. Please try again.");
  }
}

/**
 * Stop using Ratiba for renewals. We can't cancel the customer's standing
 * order for them (Daraja documents no cancel API), so they also need to remove
 * it on their phone: *334# → M-PESA Ratiba, or the Ratiba mini app.
 */
export async function stopRatiba(userId: string): Promise<void> {
  const sub = await liveSubscription(userId);
  if (!sub) throw new BillingError("You don't have an active plan.");
  await createAdminClient()
    .from("subscriptions")
    .update({ renewal_method: "manual", ratiba_status: "cancelled" })
    .eq("id", sub.id);
}
