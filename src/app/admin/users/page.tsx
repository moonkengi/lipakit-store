import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dateTime, Filters, PageHeader, StatusBadge, str, Table, Td } from "../ui";

export default function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  return (
    <div className="space-y-6">
      <PageHeader title="Users & subscriptions" />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Users searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Users({ searchParams }: Pick<PageProps<"/admin/users">, "searchParams">) {
  await requireAdmin();
  const p = await searchParams;
  const values = { q: str(p.q), status: str(p.status) };
  const supabase = await createClient();

  let query = supabase
    .from("profiles")
    .select(
      "id, email, full_name, phone, role, created_at, telegram_chat_id, subscriptions(status, current_period_end, renewal_method, plans(name))",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (values.q) {
    const q = values.q.replace(/[%,()]/g, "");
    query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%,phone.ilike.%${q.replace(/^0/, "254")}%`);
  }
  const { data: users } = await query;

  type Sub = { status: string; current_period_end: string; renewal_method: string; plans: { name: string } | null };
  const live = (subs: Sub[]) => subs.find((s) => ["trialing", "active", "grace"].includes(s.status)) ?? subs[0];
  const rows = (users ?? []).filter((u) => !values.status || live(u.subscriptions as Sub[])?.status === values.status);

  return (
    <>
      <Filters
        action="/admin/users"
        values={values}
        search="Email, name or phone"
        selects={[
          { name: "status", label: "Subscription", options: ["trialing", "active", "grace", "expired", "canceled"] },
        ]}
      />
      <Table head={["Joined", "User", "Phone", "Plan", "Status", "Period ends", "Renews by"]} empty={!rows.length}>
        {rows.map((u) => {
          const s = live(u.subscriptions as Sub[]);
          return (
            <tr key={u.id}>
              <Td>{dateTime.format(new Date(u.created_at))}</Td>
              <Td>
                {u.full_name && <div>{u.full_name}</div>}
                <div className="text-muted-foreground">{u.email}</div>
                {u.role === "admin" && <div className="text-xs font-medium">admin</div>}
              </Td>
              <Td mono>{u.phone ? `0${u.phone.slice(3)}` : "—"}</Td>
              <Td>{s?.plans?.name ?? "—"}</Td>
              <Td>{s ? <StatusBadge status={s.status} /> : "—"}</Td>
              <Td>{s ? dateTime.format(new Date(s.current_period_end)) : "—"}</Td>
              <Td>{s ? (s.renewal_method === "ratiba" ? "Ratiba" : "Reminders") : "—"}</Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
