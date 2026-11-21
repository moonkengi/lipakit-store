/**
 * Pure rules for "does this subscription unlock this feature?".
 * Used by hasAccess() in ./access.ts; kept separate so it can be unit tested.
 */
import type { Json, SubscriptionStatus } from "@/lib/supabase/database.types";

/** Statuses that grant access. Grace still has access: that's the point of grace. */
export const LIVE_STATUSES = ["trialing", "active", "grace"] as const satisfies readonly SubscriptionStatus[];

export function isLive(status: SubscriptionStatus | null | undefined): boolean {
  return status !== null && status !== undefined && (LIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * A plan's `features` jsonb, e.g. {"reports": true, "max_projects": 10}.
 * A feature is allowed when its value is true, a positive number, or a
 * non-empty string. Missing, false, 0 and "" mean no.
 */
export function featureAllows(features: Json | null | undefined, key: string): boolean {
  if (!features || typeof features !== "object" || Array.isArray(features)) return false;
  const value = (features as Record<string, Json | undefined>)[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return value.length > 0;
  return false;
}

/** A numeric limit such as max_projects, or null when the plan doesn't set one. */
export function featureLimit(features: Json | null | undefined, key: string): number | null {
  if (!features || typeof features !== "object" || Array.isArray(features)) return null;
  const value = (features as Record<string, Json | undefined>)[key];
  return typeof value === "number" ? value : null;
}
