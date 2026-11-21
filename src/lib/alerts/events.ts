/**
 * The alerts the payment flow raises, in one place so wording stays consistent.
 * All of them are fire-and-forget: they never throw into the caller.
 */
import "server-only";
import { maskPhone } from "@/lib/mpesa";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatKes } from "@/lib/utils";
import { adminLink, sendAlert } from "./index";

const masked = (phone: string | null | undefined) => (phone && /^254\d{9}$/.test(phone) ? maskPhone(phone) : null);

/** After an STK settlement: alert on paid and needs_review. */
export async function alertStkSettled(checkoutRequestId: string, orderStatus: string): Promise<void> {
  if (orderStatus !== "paid" && orderStatus !== "needs_review") return;
  const { data } = await createAdminClient()
    .from("mpesa_transactions")
    .select("phone, mpesa_receipt, orders(id, account_ref, amount_kes, status_reason)")
    .eq("checkout_request_id", checkoutRequestId)
    .maybeSingle();
  const order = data?.orders as {
    id: string;
    account_ref: string;
    amount_kes: number;
    status_reason: string | null;
  } | null;
  if (!order) return;
  await alertPayment({
    status: orderStatus,
    amountKes: order.amount_kes,
    accountRef: order.account_ref,
    channel: "STK",
    phone: data?.phone,
    receipt: data?.mpesa_receipt,
    reason: order.status_reason,
  });
}

export async function alertPayment(p: {
  status: string;
  amountKes: number;
  accountRef: string;
  channel: "STK" | "Paybill/Till";
  phone?: string | null;
  receipt?: string | null;
  reason?: string | null;
}): Promise<void> {
  const data = {
    amount_kes: p.amountKes,
    account_ref: p.accountRef,
    channel: p.channel,
    phone: masked(p.phone),
    mpesa_receipt: p.receipt ?? null,
  };
  if (p.status === "paid") {
    await sendAlert({
      type: "payment.received",
      title: `Payment received: ${formatKes(p.amountKes)}`,
      message: `${p.channel} payment for ${p.accountRef}${p.receipt ? ` (M-Pesa ${p.receipt})` : ""}.`,
      data,
      link: adminLink(`/orders?q=${encodeURIComponent(p.accountRef)}`),
    });
  } else if (p.status === "needs_review") {
    await sendAlert({
      type: "payment.needs_review",
      title: `Payment needs review: ${formatKes(p.amountKes)}`,
      message: p.reason ?? `${p.accountRef} needs a human decision.`,
      data,
      link: adminLink("/review"),
    });
  }
}

/** A callback failed to process, or a payment couldn't be matched. */
export async function alertCallbackProblem(callbackId: string, error: string): Promise<void> {
  const unmatched = error.startsWith("unmatched:") || error.startsWith("duplicate:");
  await sendAlert(
    unmatched
      ? {
          type: "payment.unmatched",
          title: error.startsWith("duplicate:") ? "Possible double payment" : "Unmatched payment",
          message: error.replace(/^(unmatched|duplicate):\s*/, ""),
          data: { callback_id: callbackId },
          link: adminLink("/unmatched"),
        }
      : {
          type: "callback.failed",
          title: "M-Pesa callback failed to process",
          message: error.slice(0, 500),
          data: { callback_id: callbackId },
          link: adminLink(`/callbacks?id=${callbackId}`),
        },
  );
}

export async function alertPayout(p: {
  id: string;
  status: string;
  amountKes: number;
  desc: string;
  receipt?: string | null;
}) {
  const ok = p.status === "success";
  await sendAlert({
    type: ok ? "payout.succeeded" : "payout.failed",
    title: ok
      ? `Payout sent: ${formatKes(p.amountKes)}`
      : `Payout ${p.status === "timeout" ? "unconfirmed" : "failed"}: ${formatKes(p.amountKes)}`,
    message: ok ? `M-Pesa ${p.receipt ?? ""}`.trim() : p.desc,
    data: { payout_id: p.id, status: p.status, amount_kes: p.amountKes, mpesa_receipt: p.receipt ?? null },
    link: adminLink("/payouts"),
  });
}
