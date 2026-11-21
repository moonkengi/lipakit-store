/**
 * Simulator controls for the dev page (/dev/simulator).
 * Returns 404 unless MPESA_MODE=simulator, so it can't exist in sandbox or production.
 *
 * GET  → current settings + recent simulated checkouts
 * POST → { nextOutcome?, delayMs?, lateCallbackDelayMs? } to change settings,
 *        { action: "poll" } to run the status poller now,
 *        { action: "renewals" } to run the renewals job now,
 *        { action: "c2b_payment", accountRef, amountKes, phone } to fake a Paybill payment,
 *        { action: "ratiba_execute", accountRef } to fake one standing-order payment
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { runRenewals } from "@/lib/billing/renewals-runner";
import {
  getSimulatorSettings,
  listSimulatedCheckouts,
  listSimulatedStandingOrders,
  simulateC2BPayment,
  simulateRatibaExecution,
  simulatorOutcomes,
  updateSimulatorSettings,
} from "@/lib/mpesa/simulator";
import { callbackUrl, createSupabaseStkStore, getMpesaClient } from "@/lib/payments";
import { pollPendingStk } from "@/lib/reconcile/stk";

const bodySchema = z.union([
  z.object({ action: z.literal("poll") }),
  z.object({ action: z.literal("renewals") }),
  z.object({
    action: z.literal("c2b_payment"),
    accountRef: z.string().max(20),
    amountKes: z.number().int().min(1),
    phone: z.string(),
  }),
  z.object({ action: z.literal("ratiba_execute"), accountRef: z.string().max(20) }),
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
  return NextResponse.json({
    settings: getSimulatorSettings(),
    checkouts: listSimulatedCheckouts(),
    standingOrders: listSimulatedStandingOrders(),
  });
}

export async function POST(request: Request) {
  if (disabled()) return new NextResponse(null, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  if ("action" in parsed.data) {
    const body = parsed.data;
    try {
      switch (body.action) {
        case "poll":
          // The poller only looks at pushes older than 60s; this runs it without waiting for the timer.
          return NextResponse.json({
            summary: await pollPendingStk({ store: createSupabaseStkStore(), mpesa: getMpesaClient() }),
          });
        case "renewals":
          return NextResponse.json({ summary: await runRenewals() });
        case "c2b_payment": {
          const transId = await simulateC2BPayment({
            confirmationUrl: callbackUrl("c2b/confirm"),
            accountRef: body.accountRef,
            amountKes: body.amountKes,
            phone: body.phone,
          });
          return NextResponse.json({ summary: { sent: "C2B confirmation", transId } });
        }
        case "ratiba_execute": {
          const transId = await simulateRatibaExecution({
            accountReference: body.accountRef,
            confirmationUrl: callbackUrl("c2b/confirm"),
          });
          return NextResponse.json({ summary: { sent: "Ratiba payment (as C2B confirmation)", transId } });
        }
      }
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }
  return NextResponse.json({ settings: updateSimulatorSettings(parsed.data) });
}
