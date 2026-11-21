/**
 * Paystack webhook: POST /api/hooks/<MPESA_CALLBACK_TOKEN>/paystack
 * Set it in Paystack → Settings → API Keys & Webhooks → Webhook URL.
 *
 * Signed (x-paystack-signature), logged first, then treated like any callback:
 * a hint. Settlement re-verifies the transaction with Paystack before anything changes.
 */
import { after, NextResponse, type NextRequest } from "next/server";
import { verifyPaystackSignature } from "@/lib/mpesa";
import { getServerEnv } from "@/lib/env";
import { logCallback, processPaystackEvent } from "@/lib/payments/callbacks";
import { hookTokenIsValid } from "@/lib/payments/hooks";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/hooks/[token]/paystack">) {
  const { token } = await ctx.params;
  const secret = getServerEnv().PAYSTACK_SECRET_KEY;
  if (!secret || !hookTokenIsValid(token)) return new NextResponse(null, { status: 404 });

  const body = await request.text();
  if (!verifyPaystackSignature(body, request.headers.get("x-paystack-signature"), secret)) {
    return new NextResponse(null, { status: 401 });
  }

  let logged;
  try {
    logged = await logCallback("paystack", body);
  } catch (error) {
    console.error("[paystack] could not log webhook", error);
    return new NextResponse(null, { status: 500 }); // Paystack retries; the poller is the backstop.
  }
  after(() => processPaystackEvent(logged.id, logged.payload));
  return new NextResponse(null, { status: 200 });
}
