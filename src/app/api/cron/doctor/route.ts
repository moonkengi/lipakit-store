/**
 * Server-side health checks for `pnpm run doctor`. Same checks as the admin Health
 * page. GET with `Authorization: Bearer <CRON_SECRET>`.
 */
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { runHealthChecks } from "@/lib/health";
import { hasBearer } from "@/lib/security";

export async function GET(request: Request) {
  if (!hasBearer(request, getServerEnv().CRON_SECRET)) return new NextResponse(null, { status: 401 });
  return NextResponse.json({ checks: await runHealthChecks() });
}
