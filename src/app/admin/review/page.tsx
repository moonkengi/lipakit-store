import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatKes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionForm } from "../action-form";
import { resolveReviewAction } from "../actions";
import { dateTime, PageHeader, Table, Td } from "../ui";

export default function ReviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Needs review"
        description="Money arrived but something didn't match (usually the amount). Approve to grant access, or reject and refund the customer (e.g. with a payout). A note is required either way."
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Review />
      </Suspense>
    </div>
  );
}

async function Review() {
  await requireAdmin();
  const { data: orders } = await (
    await createClient()
  )
    .from("orders")
    .select(
      "id, account_ref, amount_kes, status_reason, paid_at, created_at, profiles(email), mpesa_transactions(amount_kes, mpesa_receipt)",
    )
    .eq("status", "needs_review")
    .order("created_at", { ascending: true });

  return (
    <Table head={["Received", "Order", "Customer", "Expected", "Why", "Decision"]} empty={!orders?.length}>
      {orders?.map((o) => (
        <tr key={o.id}>
          <Td>{dateTime.format(new Date(o.paid_at ?? o.created_at))}</Td>
          <Td mono>
            <Link className="underline" href={`/admin/orders/${o.id}`}>
              {o.account_ref}
            </Link>
          </Td>
          <Td>{(o.profiles as { email: string | null } | null)?.email}</Td>
          <Td>{formatKes(o.amount_kes)}</Td>
          <Td className="max-w-64 text-xs">{o.status_reason}</Td>
          <Td>
            <ActionForm action={resolveReviewAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="orderId" value={o.id} />
              <Input name="note" placeholder="Note (required)" required className="h-8 w-48" />
              <Button type="submit" name="decision" value="approve" size="sm">
                Approve
              </Button>
              <Button type="submit" name="decision" value="reject" size="sm" variant="outline">
                Reject
              </Button>
            </ActionForm>
          </Td>
        </tr>
      ))}
    </Table>
  );
}
