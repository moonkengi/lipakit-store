/**
 * C2B validation: Daraja asks "should I accept this payment?" before it
 * completes. Only called if Safaricom enabled external validation on your
 * shortcode. Must answer quickly. POST /api/hooks/<MPESA_CALLBACK_TOKEN>/c2b/validate
 *
 * MPESA_C2B_VALIDATION=accept (default) accepts everything; "match" rejects
 * account numbers that don't belong to an unpaid order or a Ratiba subscription.
 */
import { NextResponse, type NextRequest } from "next/server";
import { C2B_ACCEPT, C2B_REJECT_ACCOUNT } from "@/lib/mpesa";
import { logCallback } from "@/lib/payments/callbacks";
import { shouldAcceptC2B } from "@/lib/payments/c2b";
import { hookTokenIsValid } from "@/lib/payments/hooks";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/hooks/[token]/c2b/validate">) {
  const { token } = await ctx.params;
  if (!hookTokenIsValid(token)) return new NextResponse(null, { status: 404 });

  const body = await request.text();
  // Keep a record, but never let logging delay or block the answer.
  const logged = logCallback("c2b_validate", body).catch((e) => console.error("[mpesa:c2b] validate log failed", e));

  let payload: unknown = null;
  try {
    payload = JSON.parse(body);
  } catch {
    // fall through: an unreadable request is rejected in "match" mode, accepted in "accept" mode
  }
  const accept = await shouldAcceptC2B(payload);
  await logged;
  return NextResponse.json(accept ? C2B_ACCEPT : C2B_REJECT_ACCOUNT);
}
