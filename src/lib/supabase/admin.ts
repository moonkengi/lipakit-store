/**
 * Service-role Supabase client. BYPASSES ROW LEVEL SECURITY.
 *
 * Use only in trusted server code that has already authorised the action:
 * payment callbacks, cron jobs, and admin actions after `requireAdmin()`.
 * The `server-only` import makes the build fail if a client component imports it.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import type { Database } from "./database.types";

let adminClient: ReturnType<typeof createClient<Database>> | undefined;

export function createAdminClient() {
  if (!adminClient) {
    const env = getServerEnv();
    adminClient = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}
