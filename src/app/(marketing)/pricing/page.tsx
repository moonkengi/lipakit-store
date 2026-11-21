import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Check } from "lucide-react";
import { siteConfig } from "@/config/site";
import { getActivePlans, intervalLabel, type Plan } from "@/lib/billing/plans";
import { getActiveProducts, type Product } from "@/lib/billing/products";
import { formatKes } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Pricing</h1>
        <p className="mt-2 text-muted-foreground">Pay with M-Pesa. No card needed, no auto-debit.</p>
      </div>
      <Suspense fallback={<p className="mt-12 text-center text-muted-foreground">Loading plans…</p>}>
        <PlanGrid />
      </Suspense>
    </div>
  );
}

async function PlanGrid() {
  const [plans, products] = await Promise.all([getActivePlans(), getActiveProducts()]);
  if (plans.length === 0 && products.length > 0) return <ProductGrid products={products} />;
  if (plans.length === 0) {
    return (
      <p className="mt-12 text-center text-muted-foreground">
        No plans yet. Run <code>supabase/seed.sql</code> or add a row to <code>plans</code>.
      </p>
    );
  }
  return (
    <>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} featured={plan.code === siteConfig.featuredPlanCode} />
        ))}
      </div>
      {products.length > 0 && (
        <>
          <h2 className="mt-16 text-center text-2xl font-semibold tracking-tight">One-time purchases</h2>
          <ProductGrid products={products} />
        </>
      )}
    </>
  );
}

function ProductGrid({ products }: { products: Product[] }) {
  return (
    <div className="mt-12 grid gap-6 md:grid-cols-3">
      {products.map((product) => (
        <Card
          key={product.id}
          className={product.code === siteConfig.featuredPlanCode ? "border-primary shadow-md" : undefined}
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{product.name}</CardTitle>
              {product.code === siteConfig.featuredPlanCode && <Badge>Most popular</Badge>}
            </div>
            {product.description && <CardDescription>{product.description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1">
            <p className="text-3xl font-bold">{formatKes(product.price_kes)}</p>
            <p className="text-sm text-muted-foreground">one-time payment</p>
            <ul className="mt-6 space-y-2 text-sm">
              {featureLines(product.features).map((line) => (
                <li key={line} className="flex items-center gap-2">
                  <Check className="size-4 text-primary" /> {line}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              variant={product.code === siteConfig.featuredPlanCode ? "default" : "outline"}
              asChild
            >
              <Link href={`/login?next=${encodeURIComponent(`/dashboard/checkout?product=${product.code}`)}`}>
                Buy {product.name}
              </Link>
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

/** Turn the features jsonb into display lines. Booleans show the key; numbers show "key: n". */
function featureLines(features: Plan["features"]): string[] {
  if (!features || typeof features !== "object" || Array.isArray(features)) return [];
  // {"lines": ["...", "..."]} keeps your order (Postgres doesn't keep jsonb key order).
  if (Array.isArray(features.lines)) return features.lines.filter((l): l is string => typeof l === "string");
  return Object.entries(features).flatMap(([key, value]) => {
    const label = key.replaceAll("_", " ");
    if (value === true) return [label];
    if (typeof value === "number" || typeof value === "string") return [`${label}: ${value}`];
    return [];
  });
}

function PlanCard({ plan, featured }: { plan: Plan; featured: boolean }) {
  return (
    <Card className={featured ? "border-primary shadow-md" : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{plan.name}</CardTitle>
          {featured && <Badge>Most popular</Badge>}
        </div>
        {plan.description && <CardDescription>{plan.description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex-1">
        <p className="text-3xl font-bold">{formatKes(plan.price_kes)}</p>
        <p className="text-sm text-muted-foreground">{intervalLabel(plan.interval)}</p>
        {plan.trial_days > 0 && <p className="mt-2 text-sm">{plan.trial_days}-day free trial</p>}
        <ul className="mt-6 space-y-2 text-sm">
          {featureLines(plan.features).map((line) => (
            <li key={line} className="flex items-center gap-2 capitalize">
              <Check className="size-4 text-primary" /> {line}
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button className="w-full" variant={featured ? "default" : "outline"} asChild>
          <Link href={`/login?next=${encodeURIComponent(`/dashboard/checkout?plan=${plan.code}`)}`}>
            Choose {plan.name}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
