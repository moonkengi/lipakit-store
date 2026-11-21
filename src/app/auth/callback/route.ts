/**
 * OAuth / magic-link landing route. Supabase redirects here with `?code=...`
 * (PKCE flow); we swap it for a session cookie and send the user on.
 *
 * Add `${NEXT_PUBLIC_SITE_URL}/auth/callback` to Supabase → Authentication →
 * URL Configuration → Redirect URLs, or sign-in links will be rejected.
 */
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const site = publicEnv.NEXT_PUBLIC_SITE_URL;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${site}${next}`);
    console.error("[auth] code exchange failed:", error.message);
  }

  return NextResponse.redirect(`${site}/login?error=auth_failed`);
}
