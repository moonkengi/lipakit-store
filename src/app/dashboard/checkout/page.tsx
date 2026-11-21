import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { intervalLabel } from "@/lib/billing/plans";
import { createClient } from "@/lib/supabase/server";
import { formatKes } from "@/lib/utils";
import { MpesaCheckout } from "@/components/mpesa-checkout";
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
  const { plan: planCode } = await searchParams;

  const supabase = await createClient();
  const { data: plan } =
    typeof planCode === "string"
      ? await supabase
          .from("plans")
          .select("code, name, price_kes, interval")
          .eq("code", planCode)
          .eq("is_active", true)
          .maybeSingle()
      : { data: null };

  if (!plan) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Choose a plan first</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/pricing">See plans</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{plan.name}</CardTitle>
        <CardDescription>
          {formatKes(plan.price_kes)} {intervalLabel(plan.interval)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MpesaCheckout
          plan={{ code: plan.code, name: plan.name, priceKes: plan.price_kes }}
          defaultPhone={user.phone}
        />
      </CardContent>
    </Card>
  );
}
