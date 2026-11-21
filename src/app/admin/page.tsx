import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminOverviewPage() {
  await requireAdmin();
  // Admin RLS policies let this user-scoped client read every row; no service role needed to read.
  const supabase = await createClient();

  const count = async (query: PromiseLike<{ count: number | null }>) => (await query).count ?? 0;
  const [users, liveSubs, pending, needsReview] = await Promise.all([
    count(supabase.from("profiles").select("*", { count: "exact", head: true })),
    count(
      supabase
        .from("subscriptions")
        .select("*", { count: "exact", head: true })
        .in("status", ["trialing", "active", "grace"]),
    ),
    count(supabase.from("orders").select("*", { count: "exact", head: true }).eq("status", "pending")),
    count(supabase.from("orders").select("*", { count: "exact", head: true }).eq("status", "needs_review")),
  ]);

  const stats = [
    { label: "Users", value: users },
    { label: "Live subscriptions", value: liveSubs },
    { label: "Pending orders", value: pending },
    { label: "Needs review", value: needsReview },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Admin overview</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{s.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Revenue numbers and the full admin panel arrive in Milestone 4.</p>
    </div>
  );
}
