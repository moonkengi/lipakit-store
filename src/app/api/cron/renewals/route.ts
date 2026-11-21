/**
 * Renewals job. Run daily (scheduled by lipakit_schedule_jobs() in your
 * Supabase project: 06:00 Nairobi time). Sends renewal reminders, moves unpaid
 * subscriptions to grace, and expires them when grace runs out.
 * Safe to run more than once a day. GET with `Authorization: Bearer <CRON_SECRET>`.
 */
import { NextResponse } from "next/server";
import { runRenewals } from "@/lib/billing/renewals-runner";
import { getServerEnv } from "@/lib/env";
import { hasBearer } from "@/lib/security";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!hasBearer(request, getServerEnv().CRON_SECRET)) return new NextResponse(null, { status: 401 });
  return NextResponse.json(await runRenewals());
}
