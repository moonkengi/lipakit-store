/**
 * Site-wide branding and display config.
 *
 * Rename the product here and nowhere else. Every page title, email
 * footer, receipt header and SMS signature reads from this object.
 */
export const siteConfig = {
  /** Product name shown in the UI, emails, SMS and receipts. */
  name: "LipaKit",
  /** One-line description used in <meta> tags and the landing page. */
  description: "M-Pesa payments for your SaaS, done right. A Next.js + Supabase starter kit.",
  /** Prefix for receipt numbers, e.g. LK-2026-000123. Keep it short. */
  receiptPrefix: "LK",
  /** Support contact shown in the footer and on receipts. */
  supportEmail: "qieuxkengi@gmail.com",
  /** Currency label for display only. Money is stored as integer KES. */
  currency: "KES",
  /** Plan code highlighted as "most popular" on the pricing page. */
  featuredPlanCode: "lipakit_solo",
} as const;

export type SiteConfig = typeof siteConfig;
