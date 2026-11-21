import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { hasAccess } from "@/lib/billing/access";
import { createClient } from "@/lib/supabase/server";
import { formatKes } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const dateFormat = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeZone: "Africa/Nairobi" });

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // RLS limits both queries to this user's rows.
  const [{ data: subscription }, { data: orders }] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("status, current_period_end, plans(name, price_kes)")
      .in("status", ["trialing", "active", "grace"])
      .maybeSingle(),
    supabase
      .from("orders")
      .select("id, account_ref, amount_kes, status, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  // Example feature gate: plans with {"reports": true} in their features unlock this card.
  const canSeeReports = await hasAccess(user, "reports");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome{user.fullName ? `, ${user.fullName}` : ""}</h1>

      <Card>
        <CardHeader>
          <CardTitle>Your plan</CardTitle>
          <CardDescription>
            {subscription
              ? `Renews ${dateFormat.format(new Date(subscription.current_period_end))}`
              : "You don't have a plan yet."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          {subscription ? (
            <div className="flex items-center gap-3">
              <span className="font-medium">{subscription.plans?.name}</span>
              <Badge variant="secondary" className="capitalize">
                {subscription.status}
              </Badge>
            </div>
          ) : (
            <Button asChild>
              <Link href="/pricing">Choose a plan</Link>
            </Button>
          )}
          {subscription && (
            <Button asChild variant="outline">
              <Link href="/dashboard/billing">Manage billing</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reports</CardTitle>
          <CardDescription>A sample feature gate. See docs/07-customising.md.</CardDescription>
        </CardHeader>
        <CardContent>
          {canSeeReports ? (
            <p className="text-sm">Your plan includes reports. Build them here.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Reports are on the Pro plan.{" "}
              <Link href="/pricing" className="underline">
                Upgrade
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment history</CardTitle>
          <CardDescription>Your M-Pesa payments and receipts appear here.</CardDescription>
        </CardHeader>
        <CardContent>
          {orders && orders.length > 0 ? (
            <ul className="divide-y text-sm">
              {orders.map((o) => (
                <li key={o.id} className="flex justify-between py-2">
                  <span className="font-mono">{o.account_ref}</span>
                  <span>{formatKes(o.amount_kes)}</span>
                  <Badge variant="outline" className="capitalize">
                    {o.status.replace("_", " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
