/**
 * Notification wiring from env vars. Every channel is optional: when its keys
 * aren't set, sending is skipped (and logged once), never an error. All keys
 * belong to the buyer's own accounts.
 */
import "server-only";
import { getServerEnv } from "@/lib/env";
import { createResendEmail } from "./email";
import { createAfricasTalkingSms } from "./sms";
import { pushEnabled, pushToUsers } from "./push";
import { createTelegram } from "./telegram";
import type { EmailMessage, EmailSender, SendResult, SmsSender, TelegramSender } from "./types";

export type Notifier = {
  sms: SmsSender | null;
  email: EmailSender | null;
  telegram: TelegramSender | null;
};

let notifier: Notifier | undefined;

export function getNotifier(): Notifier {
  if (!notifier) {
    const env = getServerEnv();
    notifier = {
      sms:
        env.AT_USERNAME && env.AT_API_KEY
          ? createAfricasTalkingSms({ username: env.AT_USERNAME, apiKey: env.AT_API_KEY, senderId: env.AT_SENDER_ID })
          : null,
      email:
        env.RESEND_API_KEY && env.EMAIL_FROM
          ? createResendEmail({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
          : null,
      telegram: env.TELEGRAM_BOT_TOKEN ? createTelegram({ botToken: env.TELEGRAM_BOT_TOKEN }) : null,
    };
    const off = Object.entries(notifier)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (off.length) console.info(`[notify] not configured, will skip: ${off.join(", ")}`);
  }
  return notifier;
}

export type Recipient = {
  phone?: string | null;
  email?: string | null;
  telegramChatId?: number | null;
  /** Enables web push to the user's opted-in browsers. */
  userId?: string | null;
};
export type Message = {
  sms: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailMessage["attachments"];
};

export type DeliveryReport = { sms?: SendResult; email?: SendResult; telegram?: SendResult; push?: SendResult };

/** Send one message on every channel the recipient has and the app has configured. */
export async function notifyRecipient(
  to: Recipient,
  message: Message,
  n: Notifier = getNotifier(),
): Promise<DeliveryReport> {
  const report: DeliveryReport = {};
  const jobs: Promise<void>[] = [];
  if (n.sms && to.phone) jobs.push(n.sms.send(to.phone, message.sms).then((r) => void (report.sms = r)));
  if (n.email && to.email) {
    jobs.push(
      n.email
        .send({
          to: to.email,
          subject: message.subject,
          text: message.text,
          html: message.html,
          attachments: message.attachments,
        })
        .then((r) => void (report.email = r)),
    );
  }
  if (n.telegram && to.telegramChatId) {
    jobs.push(n.telegram.send(to.telegramChatId, message.text).then((r) => void (report.telegram = r)));
  }
  if (to.userId && pushEnabled()) {
    jobs.push(
      pushToUsers([to.userId], { title: message.subject, body: message.sms }).then(
        (n) => void (report.push = n > 0 ? { ok: true } : { ok: false, error: "no browser subscribed" }),
      ),
    );
  }
  await Promise.all(jobs);
  for (const [channel, r] of Object.entries(report)) {
    if (r && !r.ok && channel !== "push") console.error(`[notify] ${channel} failed:`, r.error);
  }
  return report;
}

export type { EmailSender, SmsSender, TelegramSender } from "./types";
