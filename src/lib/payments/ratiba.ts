/**
 * Ratiba callback: the customer approved (or didn't) the standing order we
 * requested. Recurring payments themselves arrive later as C2B confirmations
 * (see lib/mpesa/ratiba.ts for the assumption and lib/reconcile/c2b.ts for matching).
 */
import "server-only";
import { parseRatibaCallback } from "@/lib/mpesa";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordProcessing } from "./callbacks";

export async function processRatibaCallback(callbackId: string, payload: unknown): Promise<void> {
  try {
    const cb = parseRatibaCallback(payload);
    if (!cb.requestRefId) throw new Error("Ratiba callback has no request reference");
    const db = createAdminClient();

    const { data: request } = await db
      .from("mpesa_transactions")
      .select("id, status, account_ref")
      .eq("kind", "ratiba")
      .eq("merchant_request_id", cb.requestRefId)
      .maybeSingle();
    if (!request?.account_ref) throw new Error(`No Ratiba request with reference ${cb.requestRefId}`);
    if (request.status !== "pending") {
      await recordProcessing(callbackId, null); // duplicate callback: already handled
      return;
    }

    await db
      .from("mpesa_transactions")
      .update({ status: cb.ok ? "success" : "failed", result_desc: cb.description || cb.code, raw: payload as never })
      .eq("id", request.id)
      .eq("status", "pending");

    await db
      .from("subscriptions")
      .update(
        cb.ok
          ? { renewal_method: "ratiba", ratiba_status: "active" }
          : { renewal_method: "manual", ratiba_status: "failed" },
      )
      .eq("ratiba_account_ref", request.account_ref);

    await recordProcessing(callbackId, cb.ok ? null : `Standing order not created (code ${cb.code})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[mpesa:ratiba] processing failed", callbackId, message);
    await recordProcessing(callbackId, message);
  }
}
