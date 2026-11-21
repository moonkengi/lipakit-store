/**
 * sendAlert(): tell admins (and your other systems) that something happened.
 * Fans out to every channel configured in env (Telegram admin chats, Slack,
 * Discord, a signed webhook, and web push to admins). Unconfigured channels are
 * skipped. Never throws: an alert must never break a payment flow.
 */
import "server-only";
import { getServerEnv } from "@/lib/env";
import { pushEnabled, pushToUsers } from "@/lib/notify/push";
import { createAdminClient } from "@/lib/supabase/admin";
import { discordChannel, slackChannel, telegramChannel } from "./channels";
import type { AlertChannel, AlertEvent, ChannelResult } from "./types";
import { webhookChannel } from "./webhook";

let channels: AlertChannel[] | undefined;

export function configuredAlertChannels(): AlertChannel[] {
  if (!channels) {
    const env = getServerEnv();
    channels = [];
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_CHAT_IDS.length) {
      channels.push(telegramChannel(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_ADMIN_CHAT_IDS));
    }
    if (env.SLACK_WEBHOOK_URL) channels.push(slackChannel(env.SLACK_WEBHOOK_URL));
    if (env.DISCORD_WEBHOOK_URL) channels.push(discordChannel(env.DISCORD_WEBHOOK_URL));
    if (env.ALERT_WEBHOOK_URL && env.ALERT_WEBHOOK_SECRET) {
      channels.push(webhookChannel(env.ALERT_WEBHOOK_URL, env.ALERT_WEBHOOK_SECRET));
    }
    if (pushEnabled()) {
      channels.push({
        name: "push",
        async send(event) {
          const { data: admins } = await createAdminClient().from("profiles").select("id").eq("role", "admin");
          const delivered = await pushToUsers(
            (admins ?? []).map((a) => a.id),
            { title: event.title, body: event.message, url: event.link },
          );
          return { channel: "push", ok: true, error: delivered === 0 ? "no admin has push enabled" : undefined };
        },
      });
    }
  }
  return channels;
}

export async function sendAlert(event: AlertEvent): Promise<ChannelResult[]> {
  try {
    const results = await Promise.all(
      configuredAlertChannels().map((c) =>
        c.send(event).catch((e: unknown) => ({ channel: c.name, ok: false, error: String(e) })),
      ),
    );
    for (const r of results) if (!r.ok) console.error(`[alerts] ${r.channel} failed:`, r.error);
    return results;
  } catch (error) {
    console.error("[alerts] dispatch failed", error);
    return [];
  }
}

/** Absolute link into the admin panel. */
export function adminLink(path: string): string {
  return `${getServerEnv().NEXT_PUBLIC_SITE_URL}/admin${path}`;
}

export type { AlertEvent, AlertType, ChannelResult } from "./types";
