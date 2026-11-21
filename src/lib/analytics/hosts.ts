/** PostHog cloud hosts per region. Browser traffic goes through /ingest on our own domain (see next.config.ts). */
export const POSTHOG_HOSTS = {
  eu: { api: "https://eu.i.posthog.com", assets: "https://eu-assets.i.posthog.com", ui: "https://eu.posthog.com" },
  us: { api: "https://us.i.posthog.com", assets: "https://us-assets.i.posthog.com", ui: "https://us.posthog.com" },
} as const;
