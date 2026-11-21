/**
 * C2B wiring: Supabase-backed matching store, confirmation processing,
 * validation, and registering the URLs with Safaricom.
 */
import "server-only";
import { ZodError } from "zod";
import { siteConfig } from "@/config/site";
import { alertPayment } from "@/lib/alerts/events";
import { fulfilReceipts } from "@/lib/billing/fulfil";
import { getServerEnv } from "@/lib/env";
import { parseC2BPayload, type C2BResponseType } from "@/lib/mpesa";
import { isPayableAccountRef, processC2BPayment, type C2BStore } from "@/lib/reconcile/c2b";
import type { Json, OrderStatus } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordProcessing } from "./callbacks";
import { callbackUrl, getMpesaClient } from "./mpesa-client";

const UNPAID: OrderStatus[] = ["pending", "expired", "failed", "cancelled"];

export function createSupabaseC2BStore(): C2BStore {
  const db = createAdminClient();
  return {
    async findOrderByAccountRef(ref) {
      const { data } = await db.from("orders").select("id, amount_kes, status").ilike("account_ref", ref).maybeSingle();
      return data ? { id: data.id, amountKes: data.amount_kes, status: data.status } : null;
    },
    async findSubscriptionByRatibaRef(ref) {
      const { data } = await db
        .from("subscriptions")
        .select("id, plans(price_kes)")
        .ilike("ratiba_account_ref", ref)
        .maybeSingle();
      return data?.plans ? { id: data.id, priceKes: data.plans.price_kes } : null;
    },
    async findOrdersByPhoneAndAmount(phone, amountKes, since) {
      // Phone can be on the user's profile, or on an STK attempt for that order.
      const [{ data: byProfile }, { data: byTx }] = await Promise.all([
        db
          .from("orders")
          .select("id, amount_kes, status, profiles!inner(phone)")
          .eq("profiles.phone", phone)
          .eq("amount_kes", amountKes)
          .in("status", UNPAID)
          .gte("created_at", since.toISOString()),
        db
          .from("mpesa_transactions")
          .select("order_id, orders!inner(id, amount_kes, status, created_at)")
          .eq("phone", phone)
          .eq("orders.amount_kes", amountKes)
          .in("orders.status", UNPAID)
          .gte("orders.created_at", since.toISOString()),
      ]);
      const found = new Map<string, { id: string; amountKes: number; status: string }>();
      for (const o of byProfile ?? []) found.set(o.id, { id: o.id, amountKes: o.amount_kes, status: o.status });
      for (const t of byTx ?? []) {
        const o = t.orders as unknown as { id: string; amount_kes: number; status: string } | null;
        if (o) found.set(o.id, { id: o.id, amountKes: o.amount_kes, status: o.status });
      }
      return [...found.values()];
    },
    async settle(payment, decision, raw) {
      const { data, error } = await db.rpc("mpesa_settle_c2b", {
        p_trans_id: payment.transId,
        p_amount: payment.amountKes,
        p_account_ref: payment.accountRef,
        p_phone: payment.phone ?? "",
        p_trans_time: payment.paidAt.toISOString(),
        p_raw: raw as Json,
        p_order_id: decision.orderId ?? undefined,
        p_subscription_id: decision.subscriptionId ?? undefined,
        p_order_status: decision.orderStatus ?? undefined,
        p_order_reason: decision.reason,
        p_receipt_prefix: siteConfig.receiptPrefix,
      });
      if (error) throw new Error(`settle_c2b: ${error.message}`);
      return data as Awaited<ReturnType<C2BStore["settle"]>>;
    },
  };
}

/** Process one logged C2B confirmation. Never throws: problems go on the log row. */
export async function processC2BConfirmation(callbackId: string, payload: unknown): Promise<void> {
  try {
    const payment = parseC2BPayload(payload);
    const { decision, outcome } = await processC2BPayment(createSupabaseC2BStore(), payment, payload);
    await recordProcessing(
      callbackId,
      outcome === "unmatched" || outcome === "duplicate" ? `${outcome}: ${decision.reason}` : null,
    );
    if (outcome === "settled" || outcome === "needs_review") {
      await alertPayment({
        status: outcome === "settled" ? "paid" : "needs_review",
        amountKes: payment.amountKes,
        accountRef: payment.accountRef || "(none)",
        channel: "Paybill/Till",
        phone: payment.phoneIsPlain ? payment.phone : null,
        receipt: payment.transId,
        reason: decision.reason,
      });
    }
    if (outcome === "settled") await fulfilReceipts({ limit: 5 });
  } catch (error) {
    const message =
      error instanceof ZodError
        ? `Payload is not a valid C2B confirmation: ${error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
        : error instanceof Error
          ? error.message
          : String(error);
    console.error("[mpesa:c2b] processing failed", callbackId, message);
    await recordProcessing(callbackId, message);
  }
}

/** Validation URL decision. "accept" mode takes everything; "match" rejects unknown account numbers. */
export async function shouldAcceptC2B(payload: unknown): Promise<boolean> {
  if (getServerEnv().MPESA_C2B_VALIDATION === "accept") return true;
  try {
    return await isPayableAccountRef(createSupabaseC2BStore(), parseC2BPayload(payload).accountRef);
  } catch {
    return false;
  }
}

/** Register this app's C2B URLs for the configured shortcode (admin action). */
export async function registerC2BUrls(responseType: C2BResponseType = "Completed") {
  return getMpesaClient().registerC2BUrls({
    confirmationUrl: callbackUrl("c2b/confirm"),
    validationUrl: callbackUrl("c2b/validate"),
    responseType,
  });
}
