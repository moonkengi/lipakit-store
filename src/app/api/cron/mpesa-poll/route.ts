/**
 * Status poller. Run every minute.
 *
 * Catches "the customer paid but our app never heard": STK pushes still
 * pending after 60 seconds get an STK Query; after 10 minutes with no result
 * they expire.
 *
 * Scheduled from your own Supabase project with pg_cron (any plan):
 * `select public.lipakit_schedule_jobs(...)`, see
 * supabase/migrations/20261121000004_scheduled_jobs.sql. Locally,
 * src/instrumentation.ts calls it every 20s in simulator mode. Any other
 * scheduler works too: send GET with `Authorization: Bearer <CRON_SECRET>`.
 */
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { createSupabaseStkStore, getMpesaClient } from "@/lib/payments";
import { pollPendingStk } from "@/lib/reconcile/stk";
import { hasBearer } from "@/lib/security";
import { fulfilReceipts } from "@/lib/billing/fulfil";
import { alertStkSettled } from "@/lib/alerts/events";
import { recordJobRun } from "@/lib/jobs";

// Give slow Daraja queries room; 50 pushes × a few seconds worst case.
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!hasBearer(request, getServerEnv().CRON_SECRET)) {
    return new NextResponse(null, { status: 401 });
  }
  const result = await recordJobRun("mpesa-poll", async () => {
    const summary = await pollPendingStk({
      store: createSupabaseStkStore(),
      mpesa: getMpesaClient(),
      onSettled: (s) => alertStkSettled(s.checkoutRequestId, s.orderStatus),
    });
    // Also sweep up receipt PDFs and emails/SMS that failed the first time.
    const receipts = await fulfilReceipts({ limit: 10 }).catch((e) => {
      console.error("[cron] receipt fulfilment failed", e);
      return null;
    });
    return { ...summary, receipts };
  });
  return NextResponse.json(result);
}
