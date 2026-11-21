import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatKes } from "@/lib/utils";
import { dateTime, Filters, PageHeader, StatusBadge, str, Table, Td } from "../ui";

const STATUSES = ["pending", "paid", "failed", "expired", "needs_review", "cancelled"];
const PURPOSES = ["subscription", "renewal", "one_off"];

export default function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders & payments"
        description="Search by account number, M-Pesa receipt, phone (07…) or email."
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Orders searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Orders({ searchParams }: Pick<PageProps<"/admin/orders">, "searchParams">) {
  await requireAdmin();
  const p = await searchParams;
  const values = { status: str(p.status), purpose: str(p.purpose), q: str(p.q) };
  const supabase = await createClient();

  let query = supabase
    .from("orders")
    .select(
      "id, account_ref, purpose, amount_kes, status, status_reason, created_at, profiles(email), mpesa_transactions(mpesa_receipt, phone, kind, status)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (values.status) query = query.eq("status", values.status as never);
  if (values.purpose) query = query.eq("purpose", values.purpose as never);

  if (values.q) {
    const q = values.q.replace(/[%,()]/g, "");
    // An M-Pesa receipt or phone lives on transactions; an email on profiles; account numbers on orders.
    const phone = /^0?[17]\d{8}$/.test(q) ? `254${q.replace(/^0/, "")}` : /^254\d{9}$/.test(q) ? q : null;
    const [{ data: txs }, { data: people }] = await Promise.all([
      supabase
        .from("mpesa_transactions")
        .select("order_id")
        .or(`mpesa_receipt.ilike.${q}${phone ? `,phone.eq.${phone}` : ""}`)
        .not("order_id", "is", null),
      q.includes("@") ? supabase.from("profiles").select("id").ilike("email", `%${q}%`) : Promise.resolve({ data: [] }),
    ]);
    const orderIds = (txs ?? []).map((t) => t.order_id!).filter(Boolean);
    const userIds = (people ?? []).map((u) => u.id);
    const ors = [`account_ref.ilike.%${q}%`];
    if (orderIds.length) ors.push(`id.in.(${orderIds.join(",")})`);
    if (userIds.length) ors.push(`user_id.in.(${userIds.join(",")})`);
    query = query.or(ors.join(","));
  }
  const { data: orders } = await query;

  return (
    <>
      <Filters
        action="/admin/orders"
        values={values}
        search="Account no., receipt, phone, email"
        selects={[
          { name: "status", label: "Status", options: STATUSES },
          { name: "purpose", label: "Purpose", options: PURPOSES },
        ]}
      />
      <Table
        head={["Created", "Account no.", "Customer", "Purpose", "Amount", "Status", "M-Pesa"]}
        empty={!orders?.length}
      >
        {orders?.map((o) => (
          <tr key={o.id}>
            <Td>{dateTime.format(new Date(o.created_at))}</Td>
            <Td mono>
              <Link className="underline" href={`/admin/orders/${o.id}`}>
                {o.account_ref}
              </Link>
            </Td>
            <Td>{(o.profiles as { email: string | null } | null)?.email}</Td>
            <Td className="capitalize">{o.purpose.replace("_", " ")}</Td>
            <Td>{formatKes(o.amount_kes)}</Td>
            <Td>
              <StatusBadge status={o.status} />
            </Td>
            <Td mono>
              {(o.mpesa_transactions as { mpesa_receipt: string | null }[])
                .map((t) => t.mpesa_receipt)
                .filter(Boolean)
                .join(", ")}
            </Td>
          </tr>
        ))}
      </Table>
      {orders?.length === 100 && (
        <p className="text-xs text-muted-foreground">Showing the latest 100. Narrow with filters.</p>
      )}
    </>
  );
}
