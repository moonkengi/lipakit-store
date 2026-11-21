/**
 * Plan catalogue helpers. Plans are rows in `public.plans` (see supabase/seed.sql).
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PlanInterval, Tables } from "@/lib/supabase/database.types";

export type Plan = Tables<"plans">;

/** Active plans in display order. Readable by anyone (RLS: "plans: anyone reads active plans"). */
export async function getActivePlans(): Promise<Plan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`Could not load plans: ${error.message}`);
  return data;
}

const intervalLabels: Record<PlanInterval, string> = {
  month: "month",
  quarter: "quarter",
  year: "year",
};

/** "per month", "per year", ... */
export function intervalLabel(interval: PlanInterval): string {
  return `per ${intervalLabels[interval]}`;
}
