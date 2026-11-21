/**
 * C2B matching: which order does a Paybill/Till payment belong to?
 *
 *   1. Account number (BillRefNumber) = an order's account_ref.
 *   2. Account number = a subscription's Ratiba standing-order reference.
 *   3. Phone + exact amount: exactly one unpaid order for that phone and amount
 *      created in the 48 hours before the payment. (Only when Daraja sends the
 *      phone in plain form; C2B v2 masks it.)
 *   4. Otherwise → unmatched queue, for a human to assign in the admin panel.
 *
 * A matched payment whose amount differs from the order goes to needs_review.
 * Framework-agnostic: lookups and settlement are behind C2BStore.
 */
import type { ParsedC2BPayment } from "../mpesa/c2b";

export const PHONE_MATCH_WINDOW_MS = 48 * 60 * 60 * 1000;

export type C2BOrderCandidate = { id: string; amountKes: number; status: string };
export type C2BRatibaCandidate = { id: string; priceKes: number };

export type C2BDecision = {
  matchedBy: "account_ref" | "ratiba" | "phone_amount" | "none";
  orderId: string | null;
  subscriptionId: string | null;
  orderStatus: "paid" | "needs_review" | null;
  reason: string;
};

export type C2BOutcome = "settled" | "needs_review" | "unmatched" | "duplicate" | "noop";

export interface C2BStore {
  findOrderByAccountRef(accountRef: string): Promise<C2BOrderCandidate | null>;
  findSubscriptionByRatibaRef(accountRef: string): Promise<C2BRatibaCandidate | null>;
  /** Unpaid (pending/expired/failed/cancelled) orders for this phone and amount, created after `since`. */
  findOrdersByPhoneAndAmount(phone: string, amountKes: number, since: Date): Promise<C2BOrderCandidate[]>;
  settle(payment: ParsedC2BPayment, decision: C2BDecision, raw: unknown): Promise<C2BOutcome>;
}

function amountCheck(expected: number, paid: number): Pick<C2BDecision, "orderStatus" | "reason"> {
  return paid === expected
    ? { orderStatus: "paid", reason: "Paid via M-Pesa Paybill/Till." }
    : { orderStatus: "needs_review", reason: `Amount mismatch: expected KES ${expected}, received KES ${paid}.` };
}

/** Pure decision from the lookups. */
export function decideC2B(
  payment: ParsedC2BPayment,
  found: { byRef: C2BOrderCandidate | null; ratiba: C2BRatibaCandidate | null; byPhone: C2BOrderCandidate[] },
): C2BDecision {
  if (found.byRef) {
    // Paying an already-paid order is handled in SQL (→ unmatched as a possible double payment).
    return {
      matchedBy: "account_ref",
      orderId: found.byRef.id,
      subscriptionId: null,
      ...amountCheck(found.byRef.amountKes, payment.amountKes),
    };
  }
  if (found.ratiba) {
    return {
      matchedBy: "ratiba",
      orderId: null,
      subscriptionId: found.ratiba.id,
      ...amountCheck(found.ratiba.priceKes, payment.amountKes),
    };
  }
  if (found.byPhone.length === 1) {
    const order = found.byPhone[0];
    return {
      matchedBy: "phone_amount",
      orderId: order.id,
      subscriptionId: null,
      orderStatus: "paid",
      reason: `Matched by phone and amount (account number typed: "${payment.accountRef || "none"}").`,
    };
  }
  return {
    matchedBy: "none",
    orderId: null,
    subscriptionId: null,
    orderStatus: null,
    reason:
      found.byPhone.length > 1
        ? `Several unpaid orders match this phone and amount; assign manually.`
        : `No order matches account number "${payment.accountRef || "none"}".`,
  };
}

export async function processC2BPayment(
  store: C2BStore,
  payment: ParsedC2BPayment,
  raw: unknown,
): Promise<{ decision: C2BDecision; outcome: C2BOutcome }> {
  const byRef = payment.accountRef ? await store.findOrderByAccountRef(payment.accountRef) : null;
  const ratiba = !byRef && payment.accountRef ? await store.findSubscriptionByRatibaRef(payment.accountRef) : null;
  const byPhone =
    !byRef && !ratiba && payment.phoneIsPlain && payment.phone
      ? await store.findOrdersByPhoneAndAmount(
          payment.phone,
          payment.amountKes,
          new Date(payment.paidAt.getTime() - PHONE_MATCH_WINDOW_MS),
        )
      : [];
  const decision = decideC2B(payment, { byRef, ratiba, byPhone });
  const outcome = await store.settle(payment, decision, raw);
  return { decision, outcome };
}

/** For the validation URL in "match" mode: is this an account number we'd accept? */
export async function isPayableAccountRef(store: C2BStore, accountRef: string): Promise<boolean> {
  if (!accountRef) return false;
  const order = await store.findOrderByAccountRef(accountRef);
  if (order) return order.status !== "paid";
  return (await store.findSubscriptionByRatibaRef(accountRef)) !== null;
}
