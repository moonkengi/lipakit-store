import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { mpesaConfigFromEnv, usingPaystack } from "@/lib/payments/mpesa-client";
import { createClient } from "@/lib/supabase/server";
import { formatKes } from "@/lib/utils";
import { MpesaCheckout } from "@/components/mpesa-checkout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CancelToggle, RatibaControls } from "./billing-controls";

export const metadata: Metadata = { title: "Billing" };

const dateFmt = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeZone: "Africa/Nairobi" });

export default function BillingPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Billing />
      </Suspense>
    </div>
  );
}

const statusLabel: Record<string, string> = {
  trialing: "Free trial",
  active: "Active",
  grace: "Payment overdue",
  expired: "Expired",
  canceled: "Cancelled",
};

async function Billing() {
  const user = await requireUser("/dashboard/billing");
  const supabase = await createClient();
  const env = getServerEnv();

  // RLS limits every query here to this user's rows.
  const [{ data: sub }, { data: orders }] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(
        "id, status, current_period_end, grace_until, cancel_at_period_end, renewal_method, ratiba_status, plans(code, name, price_kes)",
      )
      .in("status", ["trialing", "active", "grace"])
      .maybeSingle(),
    supabase
      .from("orders")
      .select("id, purpose, account_ref, amount_kes, status, status_reason, created_at, paid_at, receipts(id, number)")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const openBill = orders?.find((o) => o.purpose === "renewal" && o.status === "pending" && sub);
  const mpesa = mpesaConfigFromEnv();
  const isPaybill = !usingPaystack() && mpesa.transactionType === "CustomerPayBillOnline";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            {sub?.plans?.name ?? "No plan"}
            {sub && (
              <Badge variant={sub.status === "grace" ? "destructive" : "secondary"}>{statusLabel[sub.status]}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {!sub && "You don't have a plan yet."}
            {sub?.status === "grace" &&
              `Your period ended. You keep access until ${dateFmt.format(new Date(sub.grace_until!))}; pay to continue.`}
            {sub &&
              sub.status !== "grace" &&
              (sub.cancel_at_period_end
                ? `Ends on ${dateFmt.format(new Date(sub.current_period_end))}. It won't renew.`
                : `${sub.status === "trialing" ? "Trial ends" : "Renews"} on ${dateFmt.format(new Date(sub.current_period_end))}.`)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!sub && (
            <Button asChild>
              <Link href="/pricing">Choose a plan</Link>
            </Button>
          )}
          {sub?.plans && (
            <>
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  {sub.status === "trialing" ? "Start your paid plan" : "Pay for the next period"} ·{" "}
                  {formatKes(sub.plans.price_kes)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Paying early never loses days: the new period starts when the current one ends.
                </p>
                <MpesaCheckout
                  plan={{ code: sub.plans.code, name: sub.plans.name, priceKes: sub.plans.price_kes }}
                  defaultPhone={user.phone}
                />
                {openBill && isPaybill && (
                  <p className="text-sm text-muted-foreground">
                    Or pay from your M-Pesa menu: Paybill <strong>{mpesa.partyB}</strong>, account number{" "}
                    <strong className="font-mono">{openBill.account_ref}</strong>.
                  </p>
                )}
              </div>
              <CancelToggle cancelAtPeriodEnd={sub.cancel_at_period_end} />
            </>
          )}
        </CardContent>
      </Card>

      {sub && env.MPESA_RATIBA_ENABLED && (
        <Card>
          <CardHeader>
            <CardTitle>Automatic renewal</CardTitle>
          </CardHeader>
          <CardContent>
            <RatibaControls status={sub.ratiba_status} defaultPhone={user.phone} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Payment history</CardTitle>
        </CardHeader>
        <CardContent>
          {!orders?.length ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {orders.map((o) => {
                const receipt = Array.isArray(o.receipts) ? o.receipts[0] : o.receipts;
                return (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-medium">{formatKes(o.amount_kes)}</p>
                      <p className="text-xs text-muted-foreground">
                        {dateFmt.format(new Date(o.paid_at ?? o.created_at))} ·{" "}
                        <span className="font-mono">{o.account_ref}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="capitalize">
                        {o.status.replace("_", " ")}
                      </Badge>
                      {receipt && (
                        <a className="text-sm underline" href={`/api/receipts/${receipt.id}`}>
                          Receipt {receipt.number}
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
