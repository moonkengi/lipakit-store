/**
 * Status poller. Run every minute.
 *
 * Catches "the customer paid but our app never heard": STK pushes still
 * pending after 60 seconds get an STK Query; after 10 minutes with no result
 * they expire. See vercel.json for the schedule and docs/05-deploy.md for
 * alternatives (Vercel Hobby only allows daily cron jobs).
 */
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { createSupabaseStkStore, getMpesaClient } from "@/lib/payments";
import { pollPendingStk } from "@/lib/reconcile/stk";
import { hasBearer } from "@/lib/security";

// Give slow Daraja queries room; 50 pushes × a few seconds worst case.
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!hasBearer(request, getServerEnv().CRON_SECRET)) {
    return new NextResponse(null, { status: 401 });
  }
  const summary = await pollPendingStk({ store: createSupabaseStkStore(), mpesa: getMpesaClient() });
  return NextResponse.json(summary);
}
