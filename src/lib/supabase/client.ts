/**
 * Supabase client for Client Components (browser). Anon key only; RLS applies.
 * Used for Realtime order-status subscriptions in <MpesaCheckout />.
 */
import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

export function createClient() {
  return createBrowserClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
