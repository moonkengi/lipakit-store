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
  description: "Launch an M-Pesa powered SaaS in a weekend. Daraja done right.",
  /** Prefix for receipt numbers, e.g. LK-2026-000123. Keep it short. */
  receiptPrefix: "LK",
  /** Support contact shown in the footer and on receipts. */
  supportEmail: "support@example.com",
  /** Currency label for display only. Money is stored as integer KES. */
  currency: "KES",
  /** Plan code highlighted as "most popular" on the pricing page. */
  featuredPlanCode: "pro_monthly",
} as const;

export type SiteConfig = typeof siteConfig;
