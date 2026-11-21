import type { NextConfig } from "next";

// Netlify's Supabase extension provides the anon key as SUPABASE_ANON_KEY.
// Accept it as NEXT_PUBLIC_SUPABASE_ANON_KEY so it doesn't have to be added twice.
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

const nextConfig: NextConfig = {
  ...(anonKey ? { env: { NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey } } : {}),
  cacheComponents: true,
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
