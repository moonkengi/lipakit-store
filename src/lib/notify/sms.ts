/**
 * SMS via Africa's Talking (https://africastalking.com).
 * Username "sandbox" uses their sandbox API, which doesn't deliver real SMS.
 */
import type { SendResult, SmsSender } from "./types";

export function createAfricasTalkingSms(opts: {
  username: string;
  apiKey: string;
  /** Your approved sender ID / shortcode. Omit to use Africa's Talking's default sender. */
  senderId?: string;
  fetch?: typeof fetch;
}): SmsSender {
  const fetchImpl = opts.fetch ?? fetch;
  const host = opts.username === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";

  return {
    async send(to, message): Promise<SendResult> {
      const body = new URLSearchParams({ username: opts.username, to: `+${to}`, message });
      if (opts.senderId) body.set("from", opts.senderId);
      try {
        const res = await fetchImpl(`https://${host}/version1/messaging`, {
          method: "POST",
          headers: {
            apiKey: opts.apiKey,
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        const json = (await res.json().catch(() => null)) as {
          SMSMessageData?: {
            Recipients?: { status?: string; messageId?: string; statusCode?: number }[];
            Message?: string;
          };
        } | null;
        const recipient = json?.SMSMessageData?.Recipients?.[0];
        if (!res.ok || !recipient || recipient.status !== "Success") {
          return { ok: false, error: recipient?.status ?? json?.SMSMessageData?.Message ?? `HTTP ${res.status}` };
        }
        return { ok: true, id: recipient.messageId };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
