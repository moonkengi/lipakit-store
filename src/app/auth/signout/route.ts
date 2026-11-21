import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** POST only, so a stray link or prefetch can't sign the user out. */
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // 303 turns the POST into a GET on the landing page.
  return NextResponse.redirect(`${publicEnv.NEXT_PUBLIC_SITE_URL}/`, { status: 303 });
}
