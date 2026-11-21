/**
 * Notification channels. Each is a tiny interface so a provider can be swapped
 * (e.g. Africa's Talking → another SMS gateway) by writing one adapter.
 * Framework-agnostic: adapters take config and fetch; wiring is in ./index.ts.
 */

export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

export interface SmsSender {
  /** `to` is a normalised Kenyan number, 2547XXXXXXXX. */
  send(to: string, message: string): Promise<SendResult>;
}

export type EmailAttachment = { filename: string; content: Uint8Array };

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
};

export interface EmailSender {
  send(message: EmailMessage): Promise<SendResult>;
}

export interface TelegramSender {
  send(chatId: string | number, text: string): Promise<SendResult>;
}
