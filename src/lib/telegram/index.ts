/**
 * Telegram server wiring: creating link codes, handling bot updates, and
 * registering the webhook with Telegram.
 */
import "server-only";
import { z } from "zod";
import { siteConfig } from "@/config/site";
import { getServerEnv } from "@/lib/env";
import { createTelegram } from "@/lib/notify/telegram";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateLinkCode, hashLinkCode, LINK_CODE_TTL_MS, parseStartCommand, telegramDeepLink } from "./linking";

export function telegramConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET && env.TELEGRAM_BOT_USERNAME);
}

/** A fresh one-time code for this user (older unused codes are discarded). */
export async function createTelegramLink(userId: string): Promise<{ code: string; link: string; expiresAt: Date }> {
  const env = getServerEnv();
  if (!telegramConfigured()) throw new Error("Telegram isn't set up for this app.");
  const db = createAdminClient();
  await db.from("telegram_link_codes").delete().eq("user_id", userId).is("used_at", null);
  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
  const { error } = await db
    .from("telegram_link_codes")
    .insert({ user_id: userId, code_hash: hashLinkCode(code), expires_at: expiresAt.toISOString() });
  if (error) throw new Error(`could not create link code: ${error.message}`);
  return { code, link: telegramDeepLink(env.TELEGRAM_BOT_USERNAME!, code), expiresAt };
}

export async function unlinkTelegram(userId: string): Promise<void> {
  await createAdminClient().from("profiles").update({ telegram_chat_id: null }).eq("id", userId);
}

const updateSchema = z.object({
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({ id: z.number(), type: z.string() }),
    })
    .optional(),
});

/** Handle one bot update. Returns what we replied, for logs and tests. */
export async function handleTelegramUpdate(update: unknown): Promise<string | null> {
  const parsed = updateSchema.safeParse(update);
  const message = parsed.success ? parsed.data.message : undefined;
  if (!message) return null; // edits, joins, etc.: nothing to do

  const env = getServerEnv();
  const bot = createTelegram({ botToken: env.TELEGRAM_BOT_TOKEN! });
  const reply = async (text: string) => {
    await bot.send(message.chat.id, text);
    return text;
  };

  if (message.chat.type !== "private") return reply("Please message me directly to link your account.");

  const code = parseStartCommand(message.text);
  if (!code) {
    return reply(
      `Hi! To get ${siteConfig.name} notifications here, open your ${siteConfig.name} dashboard → Settings → Link Telegram.`,
    );
  }

  const db = createAdminClient();
  // Atomically claim the code: only one update can mark it used.
  const { data: claimed } = await db
    .from("telegram_link_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code_hash", hashLinkCode(code))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("user_id")
    .maybeSingle();
  if (!claimed) return reply("That link has expired or was already used. Get a new one from your dashboard.");

  // A Telegram chat can belong to one account only.
  await db.from("profiles").update({ telegram_chat_id: null }).eq("telegram_chat_id", message.chat.id);
  await db.from("profiles").update({ telegram_chat_id: message.chat.id }).eq("id", claimed.user_id);
  return reply(`Linked! You'll get ${siteConfig.name} payment and renewal messages here.`);
}

/** Point Telegram at this app's webhook (admin action). */
export async function setTelegramWebhook(): Promise<string> {
  const env = getServerEnv();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET)
    throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET first.");
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `${env.NEXT_PUBLIC_SITE_URL}/api/telegram/webhook`,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message"],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!body?.ok) throw new Error(body?.description ?? `Telegram answered HTTP ${res.status}`);
  return body.description ?? "Webhook set";
}
