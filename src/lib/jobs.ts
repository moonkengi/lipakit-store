/**
 * Records each scheduled job run in job_runs, so the Health page can tell
 * whether the scheduler is actually firing. Keeps the last ~2 days.
 */
import "server-only";
import type { Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

const KEEP_MS = 2 * 24 * 60 * 60 * 1000;

export async function recordJobRun<T>(job: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const db = createAdminClient();
  try {
    const result = await fn();
    await db.from("job_runs").insert({ job, ok: true, duration_ms: Date.now() - started, summary: result as Json });
    return result;
  } catch (error) {
    await db.from("job_runs").insert({
      job,
      ok: false,
      duration_ms: Date.now() - started,
      summary: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  } finally {
    // Cheap housekeeping: one delete per run.
    await db
      .from("job_runs")
      .delete()
      .eq("job", job)
      .lt("created_at", new Date(Date.now() - KEEP_MS).toISOString());
  }
}
