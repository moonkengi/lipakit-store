"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createTelegramLink, unlinkTelegram } from "@/lib/telegram";

export type LinkState = { link?: string; code?: string; error?: string } | null;

export async function linkTelegramAction(): Promise<LinkState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard/settings");
  try {
    const { link, code } = await createTelegramLink(user.id);
    return { link, code };
  } catch (error) {
    console.error("[settings] telegram link failed", error);
    return { error: "Couldn't create a link. Please try again." };
  }
}

export async function unlinkTelegramAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard/settings");
  await unlinkTelegram(user.id);
  refresh();
}
