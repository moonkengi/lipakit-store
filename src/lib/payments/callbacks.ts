/**
 * Inbound Daraja callbacks: log first, process second.
 *
 * `logCallback` runs inside the request and must be fast and simple: one insert.
 * `processStkCallback` runs after the response has been sent (via `after()`)
 * and records the outcome on the log row. It is safe to run more than once,
 * which is also how "replay" works in the admin panel.
 */
import "server-only";
import { ZodError } from "zod";
import { parseStkCallback } from "@/lib/mpesa";
import { alertCallbackProblem, alertStkSettled } from "@/lib/alerts/events";
import { fulfilReceipts } from "@/lib/billing/fulfil";
import { resolveStk } from "@/lib/reconcile/stk";
import type { Json, MpesaCallbackKind } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMpesaClient } from "./mpesa-client";
import { createSupabaseStkStore } from "./supabase-store";

/** Wrong-token hits since this server started. Deliberately nothing else is logged for them. */
const COUNTER_KEY = Symbol.for("lipakit.mpesa.badTokenHits");
export function countBadToken(): number {
  const g = globalThis as unknown as Record<symbol, number | undefined>;
  g[COUNTER_KEY] = (g[COUNTER_KEY] ?? 0) + 1;
  return g[COUNTER_KEY];
}

/** Store the raw body. Returns the log row id. Unparseable bodies are kept too, wrapped. */
export async function logCallback(kind: MpesaCallbackKind, rawBody: string): Promise<{ id: string; payload: unknown }> {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = { unparseable: rawBody.slice(0, 10_000) };
  }
  const { data, error } = await createAdminClient()
    .from("mpesa_callbacks")
    .insert({ kind, payload: payload as Json })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not log ${kind} callback: ${error?.message}`);
  return { id: data.id, payload };
}

export async function recordProcessing(callbackId: string, error: string | null) {
  const { error: dbError } = await createAdminClient()
    .from("mpesa_callbacks")
    .update({ processed_at: new Date().toISOString(), error })
    .eq("id", callbackId);
  if (dbError) console.error("[mpesa:callback] could not update log row", callbackId, dbError.message);
  if (error) await alertCallbackProblem(callbackId, error);
}

/** Process one logged STK callback. Never throws: problems are written to the log row. */
/**
 * Paystack webhook (PAYMENT_PROVIDER=paystack). Only the reference is used:
 * resolveStk re-verifies with Paystack, exactly as a Daraja callback is
 * re-checked with STK Query. Events other than charges are logged and ignored.
 */
export async function processPaystackEvent(callbackId: string, payload: unknown): Promise<void> {
  const event = (payload ?? {}) as { event?: unknown; data?: { reference?: unknown } };
  const reference = typeof event.data?.reference === "string" ? event.data.reference : null;
  if (typeof event.event !== "string" || !event.event.startsWith("charge.") || !reference) {
    await recordProcessing(callbackId, null);
    return;
  }
  try {
    const result = await resolveStk({ store: createSupabaseStkStore(), mpesa: getMpesaClient() }, reference);
    await recordProcessing(callbackId, result.kind === "unknown_checkout" ? `Unknown reference ${reference}` : null);
    if (result.kind === "done" && result.outcome === "settled" && result.settlement) {
      await alertStkSettled(reference, result.settlement.orderStatus);
      if (result.settlement.orderStatus === "paid") await fulfilReceipts({ limit: 5 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[paystack] processing failed", callbackId, message);
    await recordProcessing(callbackId, message);
  }
}

export async function processStkCallback(callbackId: string, payload: unknown): Promise<void> {
  try {
    const cb = parseStkCallback(payload);
    const result = await resolveStk(
      { store: createSupabaseStkStore(), mpesa: getMpesaClient() },
      cb.checkoutRequestId,
      { resultCode: cb.resultCode, amountKes: cb.amountKes, receipt: cb.receipt, phone: cb.phone },
    );
    if (result.kind === "unknown_checkout") {
      await recordProcessing(callbackId, `Unknown CheckoutRequestID ${cb.checkoutRequestId}`);
    } else {
      // still_pending is not an error: STK Query hasn't caught up yet, and the poller will settle it.
      await recordProcessing(callbackId, null);
      if (result.kind === "done" && result.outcome === "settled" && result.settlement) {
        await alertStkSettled(cb.checkoutRequestId, result.settlement.orderStatus);
        if (result.settlement.orderStatus === "paid") await fulfilReceipts({ limit: 5 });
      }
    }
  } catch (error) {
    const message =
      error instanceof ZodError
        ? `Payload is not a valid STK callback: ${error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
        : error instanceof Error
          ? error.message
          : String(error);
    console.error("[mpesa:callback] processing failed", callbackId, message);
    await recordProcessing(callbackId, message);
  }
}
