/**
 * Shared plumbing for Daraja callback routes under /api/hooks/<token>/...:
 * check the secret token, log the raw body first, then process after the
 * response has been sent. Daraja callbacks are unsigned; see each processor
 * for how its payload is verified or matched.
 */
import "server-only";
import { after, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import type { MpesaCallbackKind } from "@/lib/supabase/database.types";
import { safeEqual } from "@/lib/security";
import { countBadToken, logCallback } from "./callbacks";

export function hookTokenIsValid(token: string): boolean {
  if (safeEqual(token, getServerEnv().MPESA_CALLBACK_TOKEN)) return true;
  countBadToken();
  return false;
}

/**
 * The standard "log first, process second" handler.
 * Daraja gets `{ ResultCode: 0 }` as soon as the payload is safely stored.
 */
export async function handleLoggedHook(
  request: Request,
  token: string,
  kind: MpesaCallbackKind,
  process: (callbackId: string, payload: unknown) => Promise<void>,
): Promise<NextResponse> {
  if (!hookTokenIsValid(token)) return new NextResponse(null, { status: 404 });

  let logged;
  try {
    logged = await logCallback(kind, await request.text());
  } catch (error) {
    // Couldn't even store it: answer 500 so Daraja may retry. Pollers are the backstop.
    console.error(`[mpesa:${kind}] could not log callback`, error);
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Temporary error" }, { status: 500 });
  }

  after(() => process(logged.id, logged.payload));
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
