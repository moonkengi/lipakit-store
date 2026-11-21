import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { maskPhone } from "@/lib/mpesa";
import { createClient } from "@/lib/supabase/server";
import { formatKes } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateTime, PageHeader, StatusBadge, Table, Td } from "../../ui";

export default function OrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <Order params={params} />
    </Suspense>
  );
}

async function Order({ params }: Pick<PageProps<"/admin/orders/[id]">, "params">) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("*, profiles(email, full_name, phone), plans(name), receipts(id, number, emailed_at, sms_at)")
    .eq("id", id)
    .maybeSingle();
  if (!order) notFound();
  const [{ data: txs }, { data: audit }] = await Promise.all([
    supabase.from("mpesa_transactions").select("*").eq("order_id", id).order("created_at"),
    supabase.from("admin_audit_log").select("*").eq("target_id", id).order("created_at"),
  ]);
  const profile = order.profiles as { email: string | null; full_name: string | null; phone: string | null } | null;
  const receipt = (Array.isArray(order.receipts) ? order.receipts[0] : order.receipts) as {
    id: string;
    number: string;
    emailed_at: string | null;
    sms_at: string | null;
  } | null;

  const rows: [string, React.ReactNode][] = [
    ["Status", <StatusBadge key="s" status={order.status} />],
    ["Reason", order.status_reason ?? "—"],
    ["Amount", formatKes(order.amount_kes)],
    ["Purpose", order.purpose],
    ["Plan", (order.plans as { name: string } | null)?.name ?? "—"],
    ["Customer", `${profile?.full_name ?? ""} ${profile?.email ?? ""}`.trim() || "—"],
    ["Created", dateTime.format(new Date(order.created_at))],
    ["Paid", order.paid_at ? dateTime.format(new Date(order.paid_at)) : "—"],
    [
      "Receipt",
      receipt ? (
        <a key="r" className="underline" href={`/api/receipts/${receipt.id}`}>
          {receipt.number}
        </a>
      ) : (
        "—"
      ),
    ],
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={`Order ${order.account_ref}`}>
        <Link href="/admin/orders" className="text-sm underline">
          All orders
        </Link>
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <h2 className="font-semibold">M-Pesa transactions</h2>
      <Table head={["Created", "Kind", "Status", "Receipt", "Phone", "Result", "Checkout ID"]} empty={!txs?.length}>
        {txs?.map((t) => (
          <tr key={t.id}>
            <Td>{dateTime.format(new Date(t.created_at))}</Td>
            <Td>{t.kind.toUpperCase()}</Td>
            <Td>
              <StatusBadge status={t.status} />
            </Td>
            <Td mono>{t.mpesa_receipt ?? "—"}</Td>
            <Td>{t.phone && /^254\d{9}$/.test(t.phone) ? maskPhone(t.phone) : "—"}</Td>
            <Td>{t.result_code !== null ? `${t.result_code}: ${t.result_desc ?? ""}` : "—"}</Td>
            <Td mono>{t.checkout_request_id ?? "—"}</Td>
          </tr>
        ))}
      </Table>
      {!!audit?.length && (
        <>
          <h2 className="font-semibold">Admin actions</h2>
          <Table head={["When", "Action", "Details"]}>
            {audit.map((a) => (
              <tr key={a.id}>
                <Td>{dateTime.format(new Date(a.created_at))}</Td>
                <Td>{a.action.replace(/_/g, " ")}</Td>
                <Td mono>{JSON.stringify(a.details)}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}
