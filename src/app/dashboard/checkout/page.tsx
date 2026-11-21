import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { intervalLabel } from "@/lib/billing/plans";
import { createClient } from "@/lib/supabase/server";
import { formatKes } from "@/lib/utils";
import { MpesaCheckout } from "@/components/mpesa-checkout";
import { startTrialAction } from "../billing/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Checkout" };

export default function CheckoutPage({ searchParams }: PageProps<"/dashboard/checkout">) {
  return (
    <div className="mx-auto max-w-md">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Checkout searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Checkout({ searchParams }: Pick<PageProps<"/dashboard/checkout">, "searchParams">) {
  const user = await requireUser("/dashboard/checkout");
  const { plan: planCode, product: productCode, error } = await searchParams;

  const supabase = await createClient();

  // One-time product: ?product=<code>
  if (typeof productCode === "string") {
    const { data: product } = await supabase
      .from("products")
      .select("code, name, description, price_kes")
      .eq("code", productCode)
      .eq("is_active", true)
      .maybeSingle();
    if (product) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>{product.name}</CardTitle>
            <CardDescription>{formatKes(product.price_kes)}, one-time payment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {product.description && <p className="text-sm text-muted-foreground">{product.description}</p>}
            <MpesaCheckout
              item={{ kind: "product", code: product.code, name: product.name, priceKes: product.price_kes }}
              defaultPhone={user.phone}
            />
          </CardContent>
        </Card>
      );
    }
  }
  const { data: plan } =
    typeof planCode === "string"
      ? await supabase
          .from("plans")
          .select("code, name, price_kes, interval, trial_days")
          .eq("code", planCode)
          .eq("is_active", true)
          .maybeSingle()
      : { data: null };

  if (!plan) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Choose what to buy first</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/pricing">See pricing</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // New users get the plan's free trial instead of paying up front.
  const { count: pastSubscriptions } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true });
  const offerTrial = plan.trial_days > 0 && (pastSubscriptions ?? 0) === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{plan.name}</CardTitle>
        <CardDescription>
          {formatKes(plan.price_kes)} {intervalLabel(plan.interval)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {typeof error === "string" && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {offerTrial ? (
          <form action={startTrialAction} className="space-y-2">
            <input type="hidden" name="planCode" value={plan.code} />
            <Button type="submit" className="w-full">
              Start your {plan.trial_days}-day free trial
            </Button>
            <p className="text-xs text-muted-foreground">
              No payment now. We&apos;ll remind you before the trial ends.
            </p>
          </form>
        ) : (
          <MpesaCheckout
            item={{ kind: "plan", code: plan.code, name: plan.name, priceKes: plan.price_kes }}
            defaultPhone={user.phone}
          />
        )}
      </CardContent>
    </Card>
  );
}
