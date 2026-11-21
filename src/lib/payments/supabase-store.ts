/**
 * StkStore backed by Supabase, using the service-role client (server only).
 * Settlement goes through the mpesa_settle_stk() Postgres function, which is
 * what makes it atomic and idempotent.
 */
import "server-only";
import { siteConfig } from "@/config/site";
import type { Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PendingStkTransaction, SettleOutcome, StkStore } from "@/lib/reconcile/stk";

type TxRow = {
  checkout_request_id: string | null;
  order_id: string | null;
  amount_kes: number | null;
  status: string;
  created_at: string;
};

function toPending(row: TxRow): PendingStkTransaction {
  return {
    checkoutRequestId: row.checkout_request_id ?? "",
    orderId: row.order_id,
    amountKes: row.amount_kes,
    status: row.status as PendingStkTransaction["status"],
    createdAt: new Date(row.created_at),
  };
}

const TX_COLUMNS = "checkout_request_id, order_id, amount_kes, status, created_at";

export function createSupabaseStkStore(receiptPrefix: string = siteConfig.receiptPrefix): StkStore {
  const db = createAdminClient();

  return {
    async findTransaction(checkoutRequestId) {
      const { data, error } = await db
        .from("mpesa_transactions")
        .select(TX_COLUMNS)
        .eq("kind", "stk")
        .eq("checkout_request_id", checkoutRequestId)
        .maybeSingle();
      if (error) throw new Error(`findTransaction: ${error.message}`);
      return data ? toPending(data) : null;
    },

    async listPendingOlderThan(cutoff, limit) {
      const { data, error } = await db
        .from("mpesa_transactions")
        .select(TX_COLUMNS)
        .eq("kind", "stk")
        .eq("status", "pending")
        .lt("created_at", cutoff.toISOString())
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`listPendingOlderThan: ${error.message}`);
      return data.map(toPending);
    },

    async settle(s) {
      const { data, error } = await db.rpc("mpesa_settle_stk", {
        p_checkout_request_id: s.checkoutRequestId,
        p_tx_status: s.txStatus,
        p_order_status: s.orderStatus,
        p_order_reason: s.orderReason,
        // Omitted keys fall back to the SQL defaults (null).
        p_result_code: s.resultCode ?? undefined,
        p_result_desc: s.resultDesc,
        p_receipt: s.receipt ?? undefined,
        p_phone: s.phone ?? undefined,
        p_raw: s.raw === null || s.raw === undefined ? undefined : (s.raw as Json),
        p_receipt_prefix: receiptPrefix,
      });
      if (error) throw new Error(`settle: ${error.message}`);
      return data as SettleOutcome;
    },
  };
}
