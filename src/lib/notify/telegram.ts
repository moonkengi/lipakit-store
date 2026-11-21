/** Telegram Bot API, plain fetch. */
import type { SendResult, TelegramSender } from "./types";

export function createTelegram(opts: { botToken: string; fetch?: typeof fetch }): TelegramSender {
  const fetchImpl = opts.fetch ?? fetch;

  return {
    async send(chatId, text): Promise<SendResult> {
      try {
        const res = await fetchImpl(`https://api.telegram.org/bot${opts.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(15_000),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          description?: string;
          result?: { message_id?: number };
        } | null;
        if (!json?.ok) return { ok: false, error: json?.description ?? `HTTP ${res.status}` };
        return { ok: true, id: String(json.result?.message_id ?? "") };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
