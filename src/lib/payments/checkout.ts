/**
 * Starting an STK checkout: create the order FIRST, then call Daraja, then
 * record the transaction. If Daraja fails, the order is marked failed with a
 * readable reason, so nothing is left dangling.
 */
import "server-only";
import { randomInt } from "node:crypto";
import { siteConfig } from "@/config/site";
import { ACCOUNT_REFERENCE_MAX, MpesaError, normalizePhone, TRANSACTION_DESC_MAX } from "@/lib/mpesa";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrderPurpose } from "@/lib/supabase/database.types";
import { callbackUrl, getMpesaClient } from "./mpesa-client";

/** Abuse guard: someone with an account could otherwise spam payment prompts to any phone. */
const MAX_PENDING_PER_WINDOW = 3;
const RATE_WINDOW_MS = 2 * 60_000;

export class CheckoutError extends Error {
  constructor(
    readonly code: "rate_limited" | "invalid_input" | "mpesa" | "internal",
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

export type StartCheckoutResult = {
  orderId: string;
  accountRef: string;
  checkoutRequestId: string;
  customerMessage: string;
  phone: string;
};

/** No 0/O/1/I, so customers can read it off an SMS and type it as a Paybill account number. */
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateAccountRef(prefix: string = siteConfig.receiptPrefix): string {
  let body = "";
  for (let i = 0; i < 8; i++) body += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `${prefix}${body}`.slice(0, ACCOUNT_REFERENCE_MAX);
}

export async function startStkCheckout(input: {
  userId: string;
  /** Needed by Paystack; ignored by Daraja. */
  email?: string | null;
  phone: string;
  amountKes: number;
  purpose: OrderPurpose;
  planId?: string;
  productId?: string;
  subscriptionId?: string;
}): Promise<StartCheckoutResult> {
  let phone: string;
  try {
    phone = normalizePhone(input.phone);
  } catch (error) {
    throw new CheckoutError("invalid_input", (error as Error).message, 400);
  }

  const db = createAdminClient();

  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.userId)
    .eq("status", "pending")
    .gte("created_at", since);
  if ((count ?? 0) >= MAX_PENDING_PER_WINDOW) {
    throw new CheckoutError(
      "rate_limited",
      "You have payments waiting. Complete or cancel them on your phone first.",
      429,
    );
  }

  // 1. Order first. Retry on the (very unlikely) account_ref collision.
  let order: { id: string; account_ref: string } | null = null;
  for (let attempt = 0; attempt < 3 && !order; attempt++) {
    const { data, error } = await db
      .from("orders")
      .insert({
        user_id: input.userId,
        purpose: input.purpose,
        plan_id: input.planId ?? null,
        product_id: input.productId ?? null,
        subscription_id: input.subscriptionId ?? null,
        amount_kes: input.amountKes,
        account_ref: generateAccountRef(),
      })
      .select("id, account_ref")
      .single();
    if (data) order = data;
    else if (error?.code !== "23505") throw new CheckoutError("internal", "We couldn't create your order.", 500);
  }
  if (!order) throw new CheckoutError("internal", "We couldn't create your order.", 500);

  // 2. Ask Daraja to prompt the customer.
  let push;
  try {
    push = await getMpesaClient().stkPush({
      phone,
      amountKes: input.amountKes,
      accountReference: order.account_ref,
      description: siteConfig.name.slice(0, TRANSACTION_DESC_MAX),
      callbackUrl: callbackUrl("stk"),
      email: input.email ?? undefined,
    });
  } catch (error) {
    const message = error instanceof MpesaError ? error.message : "We couldn't reach M-Pesa. Please try again.";
    await db.from("orders").update({ status: "failed", status_reason: message }).eq("id", order.id);
    if (!(error instanceof MpesaError)) console.error("[checkout] STK push failed", error);
    throw new CheckoutError("mpesa", message, 502);
  }

  // 3. Record the transaction. The callback and poller find it by checkout_request_id.
  const { error: txError } = await db.from("mpesa_transactions").insert({
    order_id: order.id,
    kind: "stk",
    merchant_request_id: push.merchantRequestId,
    checkout_request_id: push.checkoutRequestId,
    phone: push.phone,
    amount_kes: input.amountKes,
    raw: push.raw as never,
  });
  if (txError) {
    // The customer may still pay. Flag it for a human rather than losing track.
    console.error("[checkout] STK sent but transaction not recorded", push.checkoutRequestId, txError.message);
    await db
      .from("orders")
      .update({
        status: "needs_review",
        status_reason: `STK push ${push.checkoutRequestId} was sent but not recorded: ${txError.message}`,
      })
      .eq("id", order.id);
  }

  return {
    orderId: order.id,
    accountRef: order.account_ref,
    checkoutRequestId: push.checkoutRequestId,
    customerMessage: push.customerMessage,
    phone: push.phone,
  };
}
