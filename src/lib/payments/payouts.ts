/**
 * B2C payouts: refunds, withdrawals, rewards. Money leaves your account, so:
 *  - only admins can create one, and every payout is in the audit log;
 *  - an idempotency key (from the form) makes a double submit harmless;
 *  - a daily cap (B2C_DAILY_LIMIT_KES) limits the damage of a mistake or a
 *    compromised admin account;
 *  - a request that may have reached M-Pesa is never marked "failed": it's
 *    "timeout", and must be checked on the M-Pesa statement before resending.
 */
import "server-only";
import { alertPayout } from "@/lib/alerts/events";
import { getServerEnv } from "@/lib/env";
import { MpesaError, normalizePhone, parseB2CResult, parseB2CTimeout, type B2CCommand } from "@/lib/mpesa";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordProcessing } from "./callbacks";
import { b2cEnabled, callbackUrl, getMpesaClient } from "./mpesa-client";

export class PayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutError";
  }
}

/** Start of today in Nairobi, as a UTC instant. */
function startOfTodayNairobi(now = new Date()): Date {
  const eat = new Date(now.getTime() + 3 * 3600_000);
  return new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate()) - 3 * 3600_000);
}

export async function createPayout(input: {
  adminId: string;
  phone: string;
  amountKes: number;
  reason: string;
  command: B2CCommand;
  idempotencyKey: string;
  userId?: string | null;
}): Promise<{ id: string; status: string; duplicate: boolean }> {
  if (!b2cEnabled()) throw new PayoutError("Payouts aren't set up. Add your B2C initiator and security credential.");
  let phone: string;
  try {
    phone = normalizePhone(input.phone);
  } catch (e) {
    throw new PayoutError((e as Error).message);
  }
  if (!Number.isInteger(input.amountKes) || input.amountKes < 1)
    throw new PayoutError("Enter a whole number of shillings.");
  if (input.reason.trim().length < 3)
    throw new PayoutError("Give a reason (it appears in the audit log and on the M-Pesa message).");

  const db = createAdminClient();

  // Same key again (double click, retried request): return the first payout, send nothing.
  const { data: existing } = await db
    .from("payouts")
    .select("id, status")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing) return { ...existing, duplicate: true };

  const { data: today } = await db
    .from("payouts")
    .select("amount_kes")
    .gte("created_at", startOfTodayNairobi().toISOString())
    .in("status", ["pending", "success", "timeout"]);
  const sentToday = (today ?? []).reduce((sum, p) => sum + p.amount_kes, 0);
  const cap = getServerEnv().B2C_DAILY_LIMIT_KES;
  if (sentToday + input.amountKes > cap) {
    throw new PayoutError(
      `This would exceed today's payout limit of KES ${cap.toLocaleString("en-KE")} (KES ${sentToday.toLocaleString("en-KE")} already sent). Change B2C_DAILY_LIMIT_KES to raise it.`,
    );
  }

  const { data: payout, error } = await db
    .from("payouts")
    .insert({
      requested_by: input.adminId,
      user_id: input.userId ?? null,
      phone,
      amount_kes: input.amountKes,
      reason: input.reason.trim(),
      command_id: input.command,
      idempotency_key: input.idempotencyKey,
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    const { data: raced } = await db
      .from("payouts")
      .select("id, status")
      .eq("idempotency_key", input.idempotencyKey)
      .single();
    return { ...raced!, duplicate: true };
  }
  if (error || !payout) throw new PayoutError("Couldn't record the payout.");

  await db.from("admin_audit_log").insert({
    admin_id: input.adminId,
    action: "create_payout",
    target_type: "payout",
    target_id: payout.id,
    details: {
      phone_last3: phone.slice(-3),
      amount_kes: input.amountKes,
      reason: input.reason,
      command: input.command,
    },
  });

  try {
    const res = await getMpesaClient().b2cPayment({
      originatorConversationId: payout.id,
      phone,
      amountKes: input.amountKes,
      command: input.command,
      remarks: input.reason,
      resultUrl: callbackUrl("b2c/result"),
      timeoutUrl: callbackUrl("b2c/timeout"),
    });
    await db
      .from("payouts")
      .update({
        conversation_id: res.conversationId,
        originator_conversation_id: res.originatorConversationId,
        raw: res.raw as never,
      })
      .eq("id", payout.id);
    return { id: payout.id, status: "pending", duplicate: false };
  } catch (e) {
    // A clear rejection means nothing was sent. A timeout or network error means we don't know.
    const known = e instanceof MpesaError && (e.code === "rejected" || e.code === "invalid_input" || e.code === "auth");
    const status = known ? "failed" : "timeout";
    const desc = known
      ? (e as MpesaError).message
      : "No clear answer from M-Pesa. Check your M-Pesa statement before sending again.";
    await db.from("payouts").update({ status, result_desc: desc }).eq("id", payout.id);
    if (!known) await alertPayout({ id: payout.id, status, amountKes: input.amountKes, desc });
    throw new PayoutError(desc);
  }
}

async function findPayout(ids: { originatorConversationId: string | null; conversationId: string | null }) {
  const db = createAdminClient();
  const uuid = /^[0-9a-f-]{36}$/i;
  if (ids.originatorConversationId && uuid.test(ids.originatorConversationId)) {
    const { data } = await db
      .from("payouts")
      .select("id, status, amount_kes")
      .eq("id", ids.originatorConversationId)
      .maybeSingle();
    if (data) return data;
  }
  if (ids.conversationId) {
    const { data } = await db
      .from("payouts")
      .select("id, status, amount_kes")
      .eq("conversation_id", ids.conversationId)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

export async function processB2CResult(callbackId: string, payload: unknown): Promise<void> {
  try {
    const r = parseB2CResult(payload);
    const payout = await findPayout(r);
    if (!payout) throw new Error(`No payout for OriginatorConversationID ${r.originatorConversationId}`);
    const status = r.resultCode === 0 ? "success" : "failed";
    // A late result may follow a timeout: allow pending or timeout → final, never final → something else.
    const { data: changed } = await createAdminClient()
      .from("payouts")
      .update({
        status,
        result_code: r.resultCode,
        result_desc: r.resultDesc,
        mpesa_receipt: r.transactionId,
        receiver_name: r.receiverName,
        raw: payload as never,
      })
      .eq("id", payout.id)
      .in("status", ["pending", "timeout"])
      .select("id");
    await recordProcessing(callbackId, null);
    if (changed?.length) {
      await alertPayout({
        id: payout.id,
        status,
        amountKes: payout.amount_kes,
        desc: r.resultDesc,
        receipt: r.transactionId,
      });
    }
  } catch (error) {
    await recordProcessing(callbackId, error instanceof Error ? error.message : String(error));
  }
}

export async function processB2CTimeout(callbackId: string, payload: unknown): Promise<void> {
  try {
    const payout = await findPayout(parseB2CTimeout(payload));
    if (!payout) throw new Error("No payout matches this B2C timeout notification");
    const { data: changed } = await createAdminClient()
      .from("payouts")
      .update({
        status: "timeout",
        result_desc: "M-Pesa queue timeout. Check the statement before sending again.",
        raw: payload as never,
      })
      .eq("id", payout.id)
      .eq("status", "pending")
      .select("id");
    await recordProcessing(callbackId, null);
    if (changed?.length)
      await alertPayout({ id: payout.id, status: "timeout", amountKes: payout.amount_kes, desc: "Queue timeout" });
  } catch (error) {
    await recordProcessing(callbackId, error instanceof Error ? error.message : String(error));
  }
}
