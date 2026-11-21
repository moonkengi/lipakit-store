/**
 * Ratiba callback: the customer approved (or declined) a standing order.
 * POST /api/hooks/<MPESA_CALLBACK_TOKEN>/ratiba
 */
import type { NextRequest } from "next/server";
import { handleLoggedHook } from "@/lib/payments/hooks";
import { processRatibaCallback } from "@/lib/payments/ratiba";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/hooks/[token]/ratiba">) {
  const { token } = await ctx.params;
  return handleLoggedHook(request, token, "ratiba", processRatibaCallback);
}
