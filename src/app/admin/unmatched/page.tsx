import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { maskPhone } from "@/lib/mpesa";
import { createClient } from "@/lib/supabase/server";
import { formatKes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionForm } from "../action-form";
import { assignC2BAction } from "../actions";
import { dateTime, PageHeader, Table, Td } from "../ui";

export default function UnmatchedPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Unmatched payments"
        description="Paybill/Till payments we couldn't match to an order, including possible double payments. Assign one to an order by its account number; it's marked paid, the receipt is issued and the action is audited."
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Unmatched />
      </Suspense>
    </div>
  );
}

async function Unmatched() {
  await requireAdmin();
  const { data: txs } = await (
    await createClient()
  )
    .from("mpesa_transactions")
    .select(
      "id, created_at, transaction_time, mpesa_receipt, amount_kes, phone, account_ref, result_desc, orders(account_ref)",
    )
    .eq("status", "unmatched")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <Table
      head={["Paid", "M-Pesa", "Amount", "Phone", "Account no. typed", "Note", "Assign to order"]}
      empty={!txs?.length}
    >
      {txs?.map((t) => (
        <tr key={t.id}>
          <Td>{dateTime.format(new Date(t.transaction_time ?? t.created_at))}</Td>
          <Td mono>{t.mpesa_receipt}</Td>
          <Td>{t.amount_kes ? formatKes(t.amount_kes) : "—"}</Td>
          <Td>{t.phone && /^254\d{9}$/.test(t.phone) ? maskPhone(t.phone) : (t.phone ?? "—")}</Td>
          <Td mono>{t.account_ref || "—"}</Td>
          <Td className="max-w-56 text-xs text-muted-foreground">{t.result_desc}</Td>
          <Td>
            <ActionForm action={assignC2BAction} className="flex gap-2">
              <input type="hidden" name="txId" value={t.id} />
              <Input name="accountRef" placeholder="LKAB12CD34" required className="h-8 w-36 font-mono" />
              <Button type="submit" size="sm">
                Assign
              </Button>
            </ActionForm>
          </Td>
        </tr>
      ))}
    </Table>
  );
}
