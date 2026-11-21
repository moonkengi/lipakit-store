/**
 * Replay a logged callback: run its processor again on the stored payload.
 * Safe because every processor is idempotent (settled payments don't settle
 * twice). Use it after fixing whatever made processing fail.
 */
import "server-only";
import type { MpesaCallbackKind } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { processC2BConfirmation } from "./c2b";
import { processPaystackEvent, processStkCallback } from "./callbacks";
import { processB2CResult, processB2CTimeout } from "./payouts";
import { processRatibaCallback } from "./ratiba";

const processors: Partial<Record<MpesaCallbackKind, (id: string, payload: unknown) => Promise<void>>> = {
  stk: processStkCallback,
  paystack: processPaystackEvent,
  c2b_confirm: processC2BConfirmation,
  ratiba: processRatibaCallback,
  b2c_result: processB2CResult,
  b2c_timeout: processB2CTimeout,
};

export function isReplayable(kind: MpesaCallbackKind): boolean {
  return kind in processors;
}

export async function replayCallback(callbackId: string): Promise<{ error: string | null }> {
  const db = createAdminClient();
  const { data: row } = await db
    .from("mpesa_callbacks")
    .select("id, kind, payload, replay_count")
    .eq("id", callbackId)
    .single();
  if (!row) throw new Error("Callback not found.");
  const process = processors[row.kind];
  if (!process)
    throw new Error(`${row.kind} callbacks can't be replayed (validation answers are only meaningful live).`);

  await db
    .from("mpesa_callbacks")
    .update({ replay_count: row.replay_count + 1 })
    .eq("id", row.id);
  await process(row.id, row.payload);
  const { data: after } = await db.from("mpesa_callbacks").select("error").eq("id", row.id).single();
  return { error: after?.error ?? null };
}
