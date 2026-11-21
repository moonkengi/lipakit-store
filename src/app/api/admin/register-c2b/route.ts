/**
 * Admin-only: register this app's C2B confirmation and validation URLs with
 * Safaricom for the configured shortcode. In production Safaricom may only let
 * you register once; changing URLs later can need their support team.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { MpesaError } from "@/lib/mpesa";
import { registerC2BUrls } from "@/lib/payments/c2b";

export async function POST() {
  const user = await getCurrentUser();
  if (user?.role !== "admin") return new NextResponse(null, { status: 404 });
  try {
    const result = await registerC2BUrls();
    return NextResponse.json({ ok: true, description: result.description });
  } catch (error) {
    const message = error instanceof MpesaError ? error.message : "Registration failed.";
    if (!(error instanceof MpesaError)) console.error("[admin] register C2B failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
