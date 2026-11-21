/**
 * Business events worth telling an admin (or another system) about.
 * Payloads never carry a full phone number: Slack and Discord messages are
 * often seen by more people than the payment data should be.
 */
export type AlertType =
  | "payment.received"
  | "payment.needs_review"
  | "payment.unmatched"
  | "callback.failed"
  | "payout.succeeded"
  | "payout.failed"
  | "subscription.expired"
  | "test";

export type AlertEvent = {
  type: AlertType;
  /** One line, e.g. "Payment received: KES 1,500". */
  title: string;
  /** A sentence or two of detail. */
  message: string;
  /** Structured fields for the webhook and for building links. Masked phones only. */
  data?: Record<string, string | number | boolean | null>;
  /** Where an admin should go to act on it (absolute URL). */
  link?: string;
};

export type ChannelResult = { channel: string; ok: boolean; error?: string };

export interface AlertChannel {
  readonly name: string;
  send(event: AlertEvent): Promise<ChannelResult>;
}

/** Severity drives the emoji/colour in chat channels. */
export function severity(type: AlertType): "info" | "warning" | "error" {
  if (type === "callback.failed" || type === "payout.failed") return "error";
  if (type === "payment.needs_review" || type === "payment.unmatched") return "warning";
  return "info";
}
