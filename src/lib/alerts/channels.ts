/**
 * Admin alert channels: Slack, Discord, Telegram. All plain fetch; each
 * returns a result instead of throwing, so one broken channel can't stop the rest.
 */
import { createTelegram } from "../notify/telegram";
import { severity, type AlertChannel, type AlertEvent, type ChannelResult } from "./types";

const icon = { info: "✅", warning: "⚠️", error: "🚨" } as const;

function plainText(event: AlertEvent): string {
  const lines = [`${icon[severity(event.type)]} ${event.title}`, event.message];
  if (event.link) lines.push(event.link);
  return lines.join("\n");
}

async function post(channel: string, fetchImpl: typeof fetch, url: string, body: unknown): Promise<ChannelResult> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? { channel, ok: true } : { channel, ok: false, error: `HTTP ${res.status}` };
  } catch (error) {
    return { channel, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Slack incoming webhook (Apps → Incoming Webhooks). */
export function slackChannel(webhookUrl: string, fetchImpl: typeof fetch = fetch): AlertChannel {
  return {
    name: "slack",
    send: (event) =>
      post("slack", fetchImpl, webhookUrl, {
        text: plainText(event),
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*${icon[severity(event.type)]} ${event.title}*\n${event.message}` },
          },
          ...(event.link
            ? [
                {
                  type: "actions",
                  elements: [{ type: "button", text: { type: "plain_text", text: "Open" }, url: event.link }],
                },
              ]
            : []),
        ],
      }),
  };
}

/** Discord webhook (Server Settings → Integrations → Webhooks). */
export function discordChannel(webhookUrl: string, fetchImpl: typeof fetch = fetch): AlertChannel {
  const colour = { info: 0x2e9e5b, warning: 0xe0a100, error: 0xd93025 } as const;
  return {
    name: "discord",
    send: (event) =>
      post("discord", fetchImpl, webhookUrl, {
        // allowed_mentions: none, so an amount or name can never ping @everyone.
        allowed_mentions: { parse: [] },
        embeds: [
          {
            title: `${icon[severity(event.type)]} ${event.title}`.slice(0, 256),
            description: event.message.slice(0, 4000),
            url: event.link,
            color: colour[severity(event.type)],
            timestamp: new Date().toISOString(),
          },
        ],
      }),
  };
}

/** Telegram messages to each admin chat ID. */
export function telegramChannel(botToken: string, chatIds: string[], fetchImpl: typeof fetch = fetch): AlertChannel {
  const bot = createTelegram({ botToken, fetch: fetchImpl });
  return {
    name: "telegram",
    async send(event) {
      const results = await Promise.all(chatIds.map((id) => bot.send(id, plainText(event))));
      const failed = results.filter((r) => !r.ok);
      return failed.length
        ? { channel: "telegram", ok: false, error: failed.map((r) => (r.ok ? "" : r.error)).join("; ") }
        : { channel: "telegram", ok: true };
    },
  };
}
