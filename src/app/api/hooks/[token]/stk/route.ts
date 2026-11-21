/**
 * Daraja STK callback: POST /api/hooks/<MPESA_CALLBACK_TOKEN>/stk
 *
 * Never trusted on its own: processing confirms every result with STK Query
 * (src/lib/reconcile/stk.ts). Optional hardening: allowlist Safaricom's
 * published callback IPs at your firewall or CDN (get the current list from Safaricom).
 */
import type { NextRequest } from "next/server";
import { processStkCallback } from "@/lib/payments/callbacks";
import { handleLoggedHook } from "@/lib/payments/hooks";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/hooks/[token]/stk">) {
  const { token } = await ctx.params;
  return handleLoggedHook(request, token, "stk", processStkCallback);
}
