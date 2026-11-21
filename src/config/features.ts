/**
 * Feature flags for optional parts of the kit.
 *
 * These are build-time switches, not per-user entitlements. Per-user access
 * (which plan unlocks what) lives in `plans.features` in the database and is
 * checked with `hasAccess()` from `@/lib/billing/access` (Milestone 3).
 */
export const features = {
  /** Email magic link sign-in via Supabase Auth. */
  magicLink: true,
  /** Google OAuth via Supabase Auth. Enable the provider in Supabase first. */
  googleAuth: true,
  /** Phone OTP via Africa's Talking. Not implemented yet; see docs/DECISIONS.md. */
  phoneOtp: false,
} as const;

export type FeatureFlag = keyof typeof features;
