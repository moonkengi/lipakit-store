/**
 * Feature flags for optional parts of the kit.
 *
 * These are build-time switches, not per-user entitlements. Per-user access
 * (which plan unlocks what) lives in `plans.features` in the database and is
 * checked with `hasAccess()` from `@/lib/billing/access`.
 */
export const features = {
  /** Email magic link sign-in via Supabase Auth. */
  magicLink: true,
  /** Google OAuth via Supabase Auth. Enable the provider in Supabase first. */
  googleAuth: false, // turn on after enabling Google in Supabase → Authentication → Providers
  /**
   * Phone number + SMS code sign-in, delivered by Africa's Talking through
   * Supabase's Send SMS hook. Needs setup first: docs/01-setup.md → "Phone sign-in".
   */
  phoneOtp: false,
} as const;

export type FeatureFlag = keyof typeof features;
