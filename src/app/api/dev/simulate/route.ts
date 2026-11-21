/**
 * Simulator controls for the dev page (/dev/simulator).
 * Returns 404 unless MPESA_MODE=simulator, so it can't exist in sandbox or production.
 *
 * GET  → current settings + recent simulated checkouts
 * POST → { nextOutcome?, delayMs?, lateCallbackDelayMs? } to change settings,
 *        or { action: "poll" } to run the status poller now
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import {
  getSimulatorSettings,
  listSimulatedCheckouts,
  simulatorOutcomes,
  updateSimulatorSettings,
} from "@/lib/mpesa/simulator";
import { createSupabaseStkStore, getMpesaClient } from "@/lib/payments";
import { pollPendingStk } from "@/lib/reconcile/stk";

const bodySchema = z.union([
  z.object({ action: z.literal("poll") }),
  z.object({
    nextOutcome: z.enum(simulatorOutcomes).optional(),
    delayMs: z.number().int().min(0).max(120_000).optional(),
    lateCallbackDelayMs: z
      .number()
      .int()
      .min(0)
      .max(15 * 60_000)
      .optional(),
  }),
]);

function disabled() {
  return getServerEnv().MPESA_MODE !== "simulator";
}

export async function GET() {
  if (disabled()) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ settings: getSimulatorSettings(), checkouts: listSimulatedCheckouts() });
}

export async function POST(request: Request) {
  if (disabled()) return new NextResponse(null, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  if ("action" in parsed.data) {
    // The poller only looks at pushes older than 60s; this lets you trigger it without waiting for the timer.
    const summary = await pollPendingStk({ store: createSupabaseStkStore(), mpesa: getMpesaClient() });
    return NextResponse.json({ summary });
  }
  return NextResponse.json({ settings: updateSimulatorSettings(parsed.data) });
}
