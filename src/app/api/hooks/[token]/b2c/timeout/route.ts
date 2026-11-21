/**
 * B2C timeout callback: POST /api/hooks/<MPESA_CALLBACK_TOKEN>/b2c/timeout
 * Updates the payout; never triggers a resend (see src/lib/payments/payouts.ts).
 */
import type { NextRequest } from "next/server";
import { handleLoggedHook } from "@/lib/payments/hooks";
import { processB2CTimeout } from "@/lib/payments/payouts";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/hooks/[token]/b2c/timeout">) {
  const { token } = await ctx.params;
  return handleLoggedHook(request, token, "b2c_timeout", processB2CTimeout);
}
