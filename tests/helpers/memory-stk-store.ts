/**
 * In-memory StkStore with the same guarantees as the mpesa_settle_stk()
 * Postgres function: only a pending transaction settles; an already-final
 * success may gain a missing receipt; everything else is a no-op.
 */
import type { PendingStkTransaction, Settlement, SettleOutcome, StkStore } from "@/lib/reconcile/stk";

export type MemoryTx = PendingStkTransaction & { receipt: string | null; resultCode: number | null };
export type MemoryOrder = { id: string; amountKes: number; status: string; reason: string | null; paidAt: Date | null };

export function createMemoryStkStore() {
  const txs = new Map<string, MemoryTx>();
  const orders = new Map<string, MemoryOrder>();
  const settleCalls: Settlement[] = [];
  const outcomes: SettleOutcome[] = [];

  const store: StkStore = {
    async findTransaction(id) {
      const tx = txs.get(id);
      return tx ? { ...tx } : null;
    },
    async listPendingOlderThan(cutoff, limit) {
      return [...txs.values()]
        .filter((t) => t.status === "pending" && t.createdAt < cutoff)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit)
        .map((t) => ({ ...t }));
    },
    async settle(s): Promise<SettleOutcome> {
      settleCalls.push(s);
      const result = applySettle(s);
      outcomes.push(result);
      return result;
    },
  };

  function applySettle(s: Settlement): SettleOutcome {
    {
      const tx = txs.get(s.checkoutRequestId);
      if (!tx) throw new Error(`unknown checkout_request_id ${s.checkoutRequestId}`);
      if (tx.status !== "pending") {
        if (tx.status === "success" && tx.receipt === null && s.receipt !== null) {
          tx.receipt = s.receipt;
          return "receipt_added";
        }
        return "noop";
      }
      tx.status = s.txStatus;
      tx.resultCode = s.resultCode;
      tx.receipt = s.receipt ?? tx.receipt;
      const order = tx.orderId ? orders.get(tx.orderId) : undefined;
      if (order && order.status === "pending") {
        order.status = s.orderStatus;
        order.reason = s.orderReason;
        if (s.orderStatus === "paid" || s.orderStatus === "needs_review") order.paidAt = new Date();
      }
      return "settled";
    }
  }

  function addPending(opts: { checkoutRequestId: string; amountKes: number; createdAt: Date }) {
    const orderId = `order-${opts.checkoutRequestId}`;
    orders.set(orderId, { id: orderId, amountKes: opts.amountKes, status: "pending", reason: null, paidAt: null });
    txs.set(opts.checkoutRequestId, {
      checkoutRequestId: opts.checkoutRequestId,
      orderId,
      amountKes: opts.amountKes,
      status: "pending",
      createdAt: opts.createdAt,
      receipt: null,
      resultCode: null,
    });
    return { orderId };
  }

  return { store, txs, orders, settleCalls, outcomes, addPending };
}
