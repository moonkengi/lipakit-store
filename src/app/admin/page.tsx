import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatKes } from "@/lib/utils";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { dateTime, PageHeader, StatusBadge, Table, Td } from "./ui";

/** ISO timestamp for N hours ago (kept out of the component body: render must stay pure). */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export default async function AdminOverviewPage() {
  await requireAdmin();
  const supabase = await createClient(); // admin RLS policies allow reading everything
  const since24h = hoursAgo(24);
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

  const [revenue, unmatched, review, failed, users, recent] = await Promise.all([
    createAdminClient().rpc("admin_revenue_summary").single(),
    count(supabase.from("mpesa_transactions").select("id", { count: "exact", head: true }).eq("status", "unmatched")),
    count(supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "needs_review")),
    count(
      supabase
        .from("mpesa_callbacks")
        .select("id", { count: "exact", head: true })
        .not("error", "is", null)
        .gte("received_at", since24h)
        .not("error", "like", "unmatched:%")
        .not("error", "like", "duplicate:%"),
    ),
    count(supabase.from("profiles").select("id", { count: "exact", head: true })),
    supabase
      .from("orders")
      .select("id, account_ref, amount_kes, status, paid_at, profiles(email)")
      .eq("status", "paid")
      .order("paid_at", { ascending: false })
      .limit(8),
  ]);
  const r = revenue.data;

  const money = [
    { label: "Today", value: formatKes(Number(r?.today_kes ?? 0)) },
    { label: "This month", value: formatKes(Number(r?.month_kes ?? 0)) },
    {
      label: "MRR",
      value: formatKes(Number(r?.mrr_kes ?? 0)),
      hint: `${r?.active_subscriptions ?? 0} paying subscriptions`,
    },
    { label: "Users", value: String(users) },
  ];
  const queues = [
    { label: "Unmatched payments", value: unmatched, href: "/admin/unmatched" },
    { label: "Needs review", value: review, href: "/admin/review" },
    { label: "Failed callbacks (24 h)", value: failed, href: "/admin/callbacks?status=errors" },
  ] as const;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="Revenue in Nairobi time. MRR counts active and grace subscriptions, normalised to a month."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {money.map((m) => (
          <Card key={m.label}>
            <CardHeader>
              <CardDescription>{m.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{m.value}</CardTitle>
              {"hint" in m && <CardDescription>{m.hint}</CardDescription>}
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {queues.map((q) => (
          <Link key={q.href} href={q.href}>
            <Card className={q.value > 0 ? "border-destructive/50" : undefined}>
              <CardHeader>
                <CardDescription>{q.label}</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{q.value}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
      <div className="space-y-3">
        <h2 className="font-semibold">Recent payments</h2>
        <Table head={["Paid", "Account no.", "Customer", "Amount", "Status"]} empty={!recent.data?.length}>
          {recent.data?.map((o) => (
            <tr key={o.id}>
              <Td>{o.paid_at ? dateTime.format(new Date(o.paid_at)) : ""}</Td>
              <Td mono>
                <Link className="underline" href={`/admin/orders/${o.id}`}>
                  {o.account_ref}
                </Link>
              </Td>
              <Td>{(o.profiles as { email: string | null } | null)?.email}</Td>
              <Td>{formatKes(o.amount_kes)}</Td>
              <Td>
                <StatusBadge status={o.status} />
              </Td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}
