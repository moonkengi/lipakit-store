/**
 * Daraja STK callback.
 *
 * URL: /api/mpesa/callback/<MPESA_CALLBACK_TOKEN>/stk
 * The secret token in the path is our only cheap way to reject random traffic,
 * because Daraja doesn't sign callbacks. That's also why the payload is never
 * trusted on its own: processing confirms every result with STK Query.
 *
 * Optional hardening: allowlist Safaricom's published callback IP addresses at
 * your firewall or CDN. The list changes; get the current one from Safaricom.
 */
import { after, NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";
import { countBadToken, logCallback, processStkCallback } from "@/lib/payments/callbacks";
import { safeEqual } from "@/lib/security";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/mpesa/callback/[token]/stk">) {
  const { token } = await ctx.params;
  if (!safeEqual(token, getServerEnv().MPESA_CALLBACK_TOKEN)) {
    countBadToken();
    return new NextResponse(null, { status: 404 });
  }

  // 1. Log first. If even this fails, answer 500 so Daraja may retry; the poller is the backstop.
  let logged;
  try {
    logged = await logCallback("stk", await request.text());
  } catch (error) {
    console.error("[mpesa:callback] could not log STK callback", error);
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Temporary error" }, { status: 500 });
  }

  // 2. Process after the response is sent, so Daraja gets a fast answer.
  after(() => processStkCallback(logged.id, logged.payload));

  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
