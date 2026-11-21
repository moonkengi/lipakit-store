"use server";

/**
 * Admin server actions. Each one re-checks the admin role itself (never trust
 * that the page did), uses the service role only after that check, and money
 * actions go through audited Postgres functions.
 */
import { refresh } from "next/cache";
import { z } from "zod";
import { siteConfig } from "@/config/site";
import { sendAlert } from "@/lib/alerts";
import { requireAdmin } from "@/lib/auth";
import { registerC2BUrls } from "@/lib/payments/c2b";
import { createPayout, PayoutError } from "@/lib/payments/payouts";
import { replayCallback } from "@/lib/payments/replay";
import { createAdminClient } from "@/lib/supabase/admin";
import { setTelegramWebhook } from "@/lib/telegram";

export type AdminActionState = { ok: boolean; message: string } | null;

async function attempt(fn: () => Promise<string>): Promise<AdminActionState> {
  try {
    const message = await fn();
    refresh();
    return { ok: true, message };
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^.*?ERROR:\s*/, "") : String(error);
    return { ok: false, message };
  }
}

export async function assignC2BAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const txId = z.uuid().parse(form.get("txId"));
  const ref = String(form.get("accountRef") ?? "")
    .trim()
    .toUpperCase();
  return attempt(async () => {
    const db = createAdminClient();
    const { data: order } = await db.from("orders").select("id").ilike("account_ref", ref).maybeSingle();
    if (!order) throw new Error(`No order with account number ${ref}.`);
    const { error } = await db.rpc("admin_assign_c2b", {
      p_tx_id: txId,
      p_order_id: order.id,
      p_admin_id: admin.id,
      p_receipt_prefix: siteConfig.receiptPrefix,
    });
    if (error) throw new Error(error.message);
    return `Assigned to ${ref}. The order is paid and a receipt was issued.`;
  });
}

export async function resolveReviewAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const orderId = z.uuid().parse(form.get("orderId"));
  const approve = form.get("decision") === "approve";
  const note = String(form.get("note") ?? "");
  return attempt(async () => {
    const { error } = await createAdminClient().rpc("admin_resolve_review", {
      p_order_id: orderId,
      p_approve: approve,
      p_admin_id: admin.id,
      p_note: note,
      p_receipt_prefix: siteConfig.receiptPrefix,
    });
    if (error) throw new Error(error.message);
    return approve
      ? "Approved: the order is paid and access granted."
      : "Rejected. Refund the customer if money was received.";
  });
}

export async function replayCallbackAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const id = z.uuid().parse(form.get("callbackId"));
  return attempt(async () => {
    const { error } = await replayCallback(id);
    await createAdminClient().from("admin_audit_log").insert({
      admin_id: admin.id,
      action: "replay_callback",
      target_type: "callback",
      target_id: id,
      details: { error },
    });
    return error ? `Replayed, but it still fails: ${error}` : "Replayed successfully.";
  });
}

const payoutSchema = z.object({
  phone: z.string().min(9),
  amountKes: z.coerce.number().int().min(1),
  reason: z.string().min(3).max(100),
  command: z.enum(["BusinessPayment", "SalaryPayment", "PromotionPayment"]),
  idempotencyKey: z.string().min(8),
  confirm: z.literal("on", { message: "Tick the confirmation box." }),
});

export async function createPayoutAction(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const parsed = payoutSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  try {
    const res = await createPayout({ adminId: admin.id, ...parsed.data });
    refresh();
    return {
      ok: true,
      message: res.duplicate
        ? "Already submitted: this payout was not sent again."
        : "Sent to M-Pesa. The result appears below shortly.",
    };
  } catch (error) {
    return { ok: false, message: error instanceof PayoutError ? error.message : "Payout failed. Check the logs." };
  }
}

export async function registerC2BAction(): Promise<AdminActionState> {
  await requireAdmin();
  return attempt(async () => `Registered: ${(await registerC2BUrls()).description}`);
}

export async function setTelegramWebhookAction(): Promise<AdminActionState> {
  await requireAdmin();
  return attempt(setTelegramWebhook);
}

export async function sendTestAlertAction(): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return attempt(async () => {
    const results = await sendAlert({
      type: "test",
      title: `${siteConfig.name} test alert`,
      message: `Sent by ${admin.email ?? "an admin"} from the Integrations page.`,
    });
    if (!results.length) throw new Error("No alert channels are configured. See .env.example.");
    return results.map((r) => `${r.channel}: ${r.ok ? "ok" : `failed (${r.error})`}`).join(" · ");
  });
}
