/**
 * Email via Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * Plain fetch, no SDK. The `from` domain must be verified in Resend.
 */
import type { EmailSender, SendResult } from "./types";

export function createResendEmail(opts: { apiKey: string; from: string; fetch?: typeof fetch }): EmailSender {
  const fetchImpl = opts.fetch ?? fetch;

  return {
    async send(message): Promise<SendResult> {
      try {
        const res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: opts.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            attachments: message.attachments?.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.content).toString("base64"),
            })),
          }),
          signal: AbortSignal.timeout(15_000),
        });
        const json = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
        if (!res.ok) return { ok: false, error: json?.message ?? `HTTP ${res.status}` };
        return { ok: true, id: json?.id };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
