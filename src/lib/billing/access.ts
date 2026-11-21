/**
 * hasAccess(user, featureKey): the one feature gate. Use it in Server
 * Components, Server Actions and Route Handlers:
 *
 *   const user = await requireUser();
 *   if (!(await hasAccess(user, "reports"))) return <UpgradePrompt />;
 *
 * Not in src/proxy.ts: Next.js advises against data fetching there, and the
 * proxy only does optimistic redirects. Gate the page or route instead.
 */
import "server-only";
import { cache } from "react";
import type { CurrentUser } from "@/lib/auth";
import type { Json, SubscriptionStatus } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { featureAllows, featureLimit, LIVE_STATUSES } from "./entitlements";

export type Entitlements = {
  status: SubscriptionStatus | null;
  planCode: string | null;
  planName: string | null;
  features: Json;
};

const NONE: Entitlements = { status: null, planCode: null, planName: null, features: {} };

/** The user's live subscription and its plan features. One query per request (React cache). */
export const getEntitlements = cache(async (userId: string): Promise<Entitlements> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("status, plans(code, name, features)")
    .eq("user_id", userId)
    .in("status", [...LIVE_STATUSES])
    .maybeSingle();
  if (!data?.plans) return NONE;
  return { status: data.status, planCode: data.plans.code, planName: data.plans.name, features: data.plans.features };
});

export async function hasAccess(user: Pick<CurrentUser, "id"> | null, featureKey: string): Promise<boolean> {
  if (!user) return false;
  return featureAllows((await getEntitlements(user.id)).features, featureKey);
}

/** Numeric limit from the plan, e.g. getLimit(user, "max_projects") → 10, or null if not set. */
export async function getLimit(user: Pick<CurrentUser, "id"> | null, featureKey: string): Promise<number | null> {
  if (!user) return null;
  return featureLimit((await getEntitlements(user.id)).features, featureKey);
}

/**
 * Has the user paid for this one-time product? e.g. hasPurchased(user, "course_basics").
 * Counts only paid orders, so a payment under review doesn't unlock anything yet.
 */
export async function hasPurchased(user: Pick<CurrentUser, "id"> | null, productCode: string): Promise<boolean> {
  if (!user) return false;
  const supabase = await createClient();
  const { count } = await supabase
    .from("orders")
    .select("id, products!inner(code)", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "paid")
    .eq("products.code", productCode);
  return (count ?? 0) > 0;
}
