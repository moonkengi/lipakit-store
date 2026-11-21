import type { NextConfig } from "next";

const posthogRegion = process.env.NEXT_PUBLIC_POSTHOG_REGION === "us" ? "us" : "eu";

// Netlify's Supabase extension provides the anon key as SUPABASE_ANON_KEY.
// Accept it as NEXT_PUBLIC_SUPABASE_ANON_KEY so it doesn't have to be added twice.
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

const nextConfig: NextConfig = {
  ...(anonKey ? { env: { NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey } } : {}),
  cacheComponents: true,
  poweredByHeader: false,
  // PostHog through our own domain (/ingest), so ad-blockers don't drop analytics.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: `https://${posthogRegion}-assets.i.posthog.com/static/:path*` },
      { source: "/ingest/:path*", destination: `https://${posthogRegion}.i.posthog.com/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // HTTPS only, for two years, on this host and subdomains.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // No framing (clickjacking), no plugins, no <base> hijacking.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
