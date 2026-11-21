/**
 * Customer-facing message text, in one place so it's easy to reword or translate.
 * SMS bodies stay under 160 characters where possible (one SMS segment).
 */
import { formatKes } from "@/lib/utils";

const dateFmt = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });

export type PayInstructions = {
  link: string;
  /** Present when the shortcode is a Paybill: customers can pay from the M-Pesa menu too. */
  paybill?: { shortcode: string; accountRef: string };
};

export function renewalReminder(p: {
  product: string;
  planName: string;
  amountKes: number;
  dueDate: Date;
  pay: PayInstructions;
}) {
  const paybill = p.pay.paybill ? ` or Paybill ${p.pay.paybill.shortcode}, account ${p.pay.paybill.accountRef}` : "";
  return {
    sms: `${p.product}: your ${p.planName} plan renews ${dateFmt.format(p.dueDate)}. Pay ${formatKes(p.amountKes)} at ${p.pay.link}${paybill}`,
    subject: `Your ${p.planName} plan renews on ${dateFmt.format(p.dueDate)}`,
    text: [
      `Your ${p.product} ${p.planName} plan renews on ${dateFmt.format(p.dueDate)}.`,
      "",
      `Pay ${formatKes(p.amountKes)} with M-Pesa: ${p.pay.link}`,
      p.pay.paybill
        ? `Or pay from your M-Pesa menu: Paybill ${p.pay.paybill.shortcode}, account number ${p.pay.paybill.accountRef}.`
        : "",
      "",
      "Paying early never loses you days: your new period starts when the current one ends.",
    ]
      .filter((l) => l !== undefined)
      .join("\n"),
  };
}

export function graceStarted(p: {
  product: string;
  planName: string;
  graceUntil: Date;
  amountKes: number;
  pay: PayInstructions;
}) {
  return {
    sms: `${p.product}: your ${p.planName} plan has ended. Pay ${formatKes(p.amountKes)} by ${dateFmt.format(p.graceUntil)} to keep access: ${p.pay.link}`,
    subject: `Action needed: keep your ${p.planName} plan`,
    text: `Your ${p.product} ${p.planName} plan has ended. You still have access until ${dateFmt.format(p.graceUntil)}.\n\nPay ${formatKes(p.amountKes)} with M-Pesa to keep it: ${p.pay.link}`,
  };
}

export function subscriptionExpired(p: { product: string; planName: string; link: string }) {
  return {
    sms: `${p.product}: your ${p.planName} plan has expired. Renew anytime at ${p.link}`,
    subject: `Your ${p.planName} plan has expired`,
    text: `Your ${p.product} ${p.planName} plan has expired. You can renew anytime: ${p.link}`,
  };
}

export function paymentReceived(p: {
  product: string;
  amountKes: number;
  receiptNumber: string;
  mpesaReceipt?: string | null;
}) {
  const ref = p.mpesaReceipt ? ` M-Pesa ref ${p.mpesaReceipt}.` : "";
  return {
    sms: `${p.product}: payment of ${formatKes(p.amountKes)} received. Receipt ${p.receiptNumber}.${ref} Thank you!`,
    subject: `Receipt ${p.receiptNumber}`,
    text: `Thank you! We received your payment of ${formatKes(p.amountKes)}.${ref}\n\nYour receipt ${p.receiptNumber} is attached.`,
  };
}

export function ratibaFallback(p: { product: string; planName: string; pay: PayInstructions; amountKes: number }) {
  return {
    sms: `${p.product}: your M-Pesa standing order didn't pay for ${p.planName}. Pay ${formatKes(p.amountKes)} here to keep access: ${p.pay.link}`,
    subject: `Your automatic M-Pesa payment didn't go through`,
    text: `Your M-Pesa Ratiba standing order didn't pay for your ${p.product} ${p.planName} plan, so we've switched you to payment reminders.\n\nPay ${formatKes(p.amountKes)} here to keep access: ${p.pay.link}`,
  };
}
