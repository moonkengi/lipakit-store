"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { features } from "@/config/features";
import { publicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type MagicLinkState =
  { status: "idle" } | { status: "sent"; email: string } | { status: "error"; message: string };

const magicLinkSchema = z.object({
  email: z.email("Enter a valid email address").trim().toLowerCase(),
  next: z.string().optional(),
});

/** Where Supabase sends the user after they click the email link or finish Google sign-in. */
function callbackUrl(next: string) {
  return `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`;
}

export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  if (!features.magicLink) return { status: "error", message: "Email sign-in is disabled." };

  const parsed = magicLinkSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: callbackUrl(parsed.data.next ?? "/dashboard"), shouldCreateUser: true },
  });

  if (error) {
    console.error("[auth] magic link failed:", error.message);
    // Rate limits are the common case; Supabase's default is a few emails per hour.
    return { status: "error", message: "We couldn't send the link. Wait a minute and try again." };
  }
  return { status: "sent", email: parsed.data.email };
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  if (!features.googleAuth) redirect("/login?error=google_disabled");

  const next = typeof formData.get("next") === "string" ? (formData.get("next") as string) : "/dashboard";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl(next) },
  });

  if (error || !data.url) {
    console.error("[auth] Google sign-in failed:", error?.message);
    redirect("/login?error=google_failed");
  }
  redirect(data.url);
}
