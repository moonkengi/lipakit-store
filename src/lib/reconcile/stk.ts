/**
 * STK settlement: turning "Daraja says X" into transaction and order statuses.
 *
 * Rules (the core of "Daraja done right"):
 *  1. A callback is a hint, never proof. Daraja callbacks are unsigned, so we
 *     always confirm with STK Query before settling, success or failure.
 *  2. Settling is idempotent. Only a `pending` transaction can be settled; the
 *     database enforces this atomically (see mpesa_settle_stk), so a duplicate
 *     callback, a late callback and the poller racing each other are all safe.
 *  3. A success whose callback amount differs from the order goes to
 *     `needs_review` instead of `paid`.
 *  4. A pending push with no answer for 10 minutes expires.
 *
 * Framework-agnostic: storage is behind the StkStore interface.
 */
import { describeResultCode, type StkOrderStatus, type StkTxStatus } from "../mpesa/result-codes";
import type { MpesaClient } from "../mpesa/types";

/** STK pushes older than this without a result get an STK Query from the poller. */
export const POLL_AFTER_MS = 60_000;
/** STK pushes older than this with no result anywhere are expired. */
export const EXPIRE_AFTER_MS = 10 * 60_000;

export type PendingStkTransaction = {
  checkoutRequestId: string;
  orderId: string | null;
  /** Amount we asked the customer to pay. */
  amountKes: number | null;
  status: "pending" | StkTxStatus;
  createdAt: Date;
};

/** What the callback told us, if anything. Only used as supporting data after verification. */
export type CallbackHint = {
  resultCode: number;
  amountKes?: number;
  receipt?: string;
  phone?: string;
};

export type Settlement = {
  checkoutRequestId: string;
  txStatus: StkTxStatus;
  orderStatus: StkOrderStatus | "needs_review";
  orderReason: string;
  resultCode: number | null;
  resultDesc: string;
  receipt: string | null;
  phone: string | null;
  raw: unknown;
};

/** settled: we changed state. noop: already final, nothing to do. receipt_added: late callback filled in a receipt. */
export type SettleOutcome = "settled" | "noop" | "receipt_added";

export interface StkStore {
  findTransaction(checkoutRequestId: string): Promise<PendingStkTransaction | null>;
  /** Must be atomic and only change a transaction that is still `pending`. */
  settle(settlement: Settlement): Promise<SettleOutcome>;
  listPendingOlderThan(cutoff: Date, limit: number): Promise<PendingStkTransaction[]>;
}

/** Pure decision: given a verified result, what should be stored? */
export function decideSettlement(args: {
  tx: PendingStkTransaction;
  resultCode: number;
  resultDesc: string;
  hint?: CallbackHint;
  raw: unknown;
}): Settlement {
  const { tx, resultCode, resultDesc, hint, raw } = args;
  const info = describeResultCode(resultCode);
  // Only use callback details when they describe the same (verified) outcome.
  const usableHint = hint && hint.resultCode === resultCode ? hint : undefined;

  const base = {
    checkoutRequestId: tx.checkoutRequestId,
    txStatus: info.txStatus,
    resultCode,
    resultDesc,
    receipt: usableHint?.receipt ?? null,
    phone: usableHint?.phone ?? null,
    raw,
  };

  if (info.txStatus === "success") {
    const paid = usableHint?.amountKes;
    if (paid !== undefined && tx.amountKes !== null && paid !== tx.amountKes) {
      return {
        ...base,
        orderStatus: "needs_review",
        orderReason: `Amount mismatch: expected KES ${tx.amountKes}, M-Pesa reported KES ${paid}.`,
      };
    }
    return { ...base, orderStatus: "paid", orderReason: info.message };
  }
  return { ...base, orderStatus: info.orderStatus, orderReason: info.message };
}

export function expirySettlement(tx: PendingStkTransaction): Settlement {
  return {
    checkoutRequestId: tx.checkoutRequestId,
    txStatus: "timeout",
    orderStatus: "expired",
    orderReason: "No response from M-Pesa within 10 minutes. Please try again.",
    resultCode: null,
    resultDesc: "Expired by LipaKit: no callback and no final STK Query result.",
    receipt: null,
    phone: null,
    raw: null,
  };
}

export type ResolveResult =
  | { kind: "unknown_checkout" }
  | { kind: "still_pending" }
  | { kind: "done"; outcome: SettleOutcome; settlement?: Settlement };

/**
 * Resolve one STK push. Called from the callback route (with a hint) and from
 * the poller (without one).
 */
export async function resolveStk(
  deps: { store: StkStore; mpesa: MpesaClient },
  checkoutRequestId: string,
  hint?: CallbackHint,
): Promise<ResolveResult> {
  const tx = await deps.store.findTransaction(checkoutRequestId);
  if (!tx) return { kind: "unknown_checkout" };

  if (tx.status !== "pending") {
    // Already settled. A late callback may still carry the receipt number we
    // didn't have (e.g. the poller settled it first); the store fills it in or no-ops.
    if (!hint?.receipt || hint.resultCode !== 0) return { kind: "done", outcome: "noop" };
    const outcome = await deps.store.settle({
      checkoutRequestId,
      txStatus: "success",
      orderStatus: "paid",
      orderReason: "",
      resultCode: 0,
      resultDesc: "",
      receipt: hint.receipt,
      phone: hint.phone ?? null,
      raw: null,
    });
    return { kind: "done", outcome };
  }

  const query = await deps.mpesa.stkQuery(checkoutRequestId);
  if (query.state === "pending") return { kind: "still_pending" };

  const settlement = decideSettlement({
    tx,
    resultCode: query.resultCode,
    resultDesc: query.resultDesc,
    hint,
    raw: { query: query.raw, callback: hint ?? null },
  });
  const outcome = await deps.store.settle(settlement);
  return { kind: "done", outcome, settlement };
}

export type PollSummary = { checked: number; settled: number; expired: number; stillPending: number; errors: number };

/**
 * The status poller: catches payments whose callback never arrived.
 * Pending pushes older than 60s get an STK Query; older than 10 minutes with
 * no final answer, they expire.
 */
export async function pollPendingStk(deps: {
  store: StkStore;
  mpesa: MpesaClient;
  now?: () => Date;
  limit?: number;
}): Promise<PollSummary> {
  const now = deps.now?.() ?? new Date();
  const pending = await deps.store.listPendingOlderThan(new Date(now.getTime() - POLL_AFTER_MS), deps.limit ?? 50);
  const summary: PollSummary = { checked: 0, settled: 0, expired: 0, stillPending: 0, errors: 0 };

  for (const tx of pending) {
    summary.checked++;
    const tooOld = now.getTime() - tx.createdAt.getTime() >= EXPIRE_AFTER_MS;
    try {
      const result = await resolveStk(deps, tx.checkoutRequestId);
      if (result.kind === "done" && result.outcome === "settled") summary.settled++;
      else if (result.kind === "still_pending" && tooOld) {
        if ((await deps.store.settle(expirySettlement(tx))) === "settled") summary.expired++;
      } else if (result.kind === "still_pending") summary.stillPending++;
    } catch (error) {
      summary.errors++;
      // Query keeps failing (e.g. Daraja doesn't recognise the ID) and it's past 10 minutes: give up.
      if (tooOld && (await deps.store.settle(expirySettlement(tx))) === "settled") summary.expired++;
      else console.error("[mpesa:poller] could not resolve", tx.checkoutRequestId, error);
    }
  }
  return summary;
}
