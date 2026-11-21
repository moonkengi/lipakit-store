/**
 * C2B confirmation: a customer paid your Paybill/Till directly (or a Ratiba
 * standing order ran). POST /api/hooks/<MPESA_CALLBACK_TOKEN>/c2b/confirm
 *
 * Matched to an order by account number, then phone + amount, else it goes to
 * the unmatched queue (src/lib/reconcile/c2b.ts). TransID is unique, so a
 * repeated confirmation is a no-op.
 */
import type { NextRequest } from "next/server";
import { processC2BConfirmation } from "@/lib/payments/c2b";
import { handleLoggedHook } from "@/lib/payments/hooks";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/hooks/[token]/c2b/confirm">) {
  const { token } = await ctx.params;
  return handleLoggedHook(request, token, "c2b_confirm", processC2BConfirmation);
}
