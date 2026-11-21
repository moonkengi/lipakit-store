/**
 * Data Access Layer for the current user.
 *
 * Every page, Server Action and Route Handler that needs a user goes through
 * these helpers. They verify the session on the server, so they are the real
 * security boundary (the redirect in src/proxy.ts is only a convenience).
 */
import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRole } from "@/lib/supabase/database.types";

export type CurrentUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  role: ProfileRole;
  telegramLinked: boolean;
};

/**
 * The signed-in user with their profile, or null. Deduplicated per request
 * with React `cache`, so calling it from several components costs one lookup.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, phone, role, telegram_chat_id")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    // The sign-up trigger creates the profile; missing means a broken setup.
    console.error("[auth] profile missing for user", userId, error?.message);
    return null;
  }

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    phone: profile.phone,
    role: profile.role,
    telegramLinked: profile.telegram_chat_id !== null,
  };
});

/** The signed-in user, or redirect to /login. */
export async function requireUser(next = "/dashboard"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

/**
 * The signed-in admin. Non-admins get a 404 rather than a 403 so the admin
 * area's existence is not advertised.
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser("/admin");
  if (user.role !== "admin") notFound();
  return user;
}
