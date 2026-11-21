/**
 * B2C (Business to Customer): send money from your B2C shortcode to an M-Pesa number.
 *
 * Uses Daraja's v3 payment request, where we set OriginatorConversationID
 * ourselves (the payout's own ID), so the result can always be matched back.
 * The result arrives asynchronously at ResultURL; QueueTimeOutURL is called if
 * Safaricom couldn't process the request in time.
 *
 * Results are unsigned like every Daraja callback. A "failed" or "timeout"
 * result must never trigger an automatic resend: money may still have moved.
 * Check your M-Pesa statement (or the Transaction Status API) first.
 */
import { z } from "zod";
import { assertDarajaSafeUrl } from "./c2b";
import { MpesaError } from "./errors";
import { normalizePhone } from "./phone";

export const B2C_PATH = "/mpesa/b2c/v3/paymentrequest";

export type B2CCommand = "BusinessPayment" | "SalaryPayment" | "PromotionPayment";

export type B2CInput = {
  /** Our unique ID for this payout. Becomes OriginatorConversationID. */
  originatorConversationId: string;
  phone: string;
  amountKes: number;
  command: B2CCommand;
  /** 2–100 characters (confirm with Safaricom). */
  remarks: string;
  resultUrl: string;
  timeoutUrl: string;
  occasion?: string;
};

export type B2CCredentials = {
  initiatorName: string;
  /** The initiator password encrypted with Safaricom's certificate (generate it in the Daraja portal). */
  securityCredential: string;
  /** The B2C shortcode (PartyA). Often different from your Paybill. */
  shortcode: string;
};

export type B2CRequestResult = { conversationId: string; originatorConversationId: string; raw: unknown };

export function buildB2CRequest(creds: B2CCredentials, input: B2CInput) {
  if (!Number.isInteger(input.amountKes) || input.amountKes < 1) {
    throw new MpesaError("invalid_input", "The payout amount must be a whole number of shillings, at least KES 1.");
  }
  assertDarajaSafeUrl(input.resultUrl);
  assertDarajaSafeUrl(input.timeoutUrl);
  return {
    OriginatorConversationID: input.originatorConversationId,
    InitiatorName: creds.initiatorName,
    SecurityCredential: creds.securityCredential,
    CommandID: input.command,
    Amount: String(input.amountKes),
    PartyA: creds.shortcode,
    PartyB: normalizePhone(input.phone),
    Remarks: input.remarks.slice(0, 100).padEnd(2, "."),
    QueueTimeOutURL: input.timeoutUrl,
    ResultURL: input.resultUrl,
    Occasion: (input.occasion ?? "").slice(0, 100),
  };
}

export const b2cResponseSchema = z.object({
  ConversationID: z.string().min(1),
  OriginatorConversationID: z.string().min(1),
  ResponseCode: z.coerce.string(),
  ResponseDescription: z.string().optional(),
});

export type ParsedB2CResult = {
  originatorConversationId: string | null;
  conversationId: string | null;
  resultCode: number;
  resultDesc: string;
  /** M-Pesa receipt of the payout, on success. */
  transactionId: string | null;
  amountKes: number | null;
  /** e.g. "254712345678 - JANE DOE", as Daraja reports it. */
  receiverName: string | null;
};

/** Parse a B2C result (or timeout) body. Lenient: Daraja's shapes vary between products. */
export function parseB2CResult(body: unknown): ParsedB2CResult {
  const root = (body ?? {}) as Record<string, unknown>;
  const result = (root.Result ?? root.result ?? root) as Record<string, unknown>;
  const params = ((result.ResultParameters as { ResultParameter?: unknown } | undefined)?.ResultParameter ?? []) as
    { Key?: string; Value?: unknown }[] | { Key?: string; Value?: unknown };
  const list = Array.isArray(params) ? params : [params];
  const param = (key: string) => list.find((p) => p?.Key === key)?.Value;
  const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
  const code = Number(result.ResultCode ?? NaN);
  if (!Number.isFinite(code)) throw new MpesaError("invalid_response", "B2C result has no ResultCode.");
  const amount = param("TransactionAmount");
  return {
    originatorConversationId: str(result.OriginatorConversationID),
    conversationId: str(result.ConversationID),
    resultCode: code,
    resultDesc: String(result.ResultDesc ?? ""),
    transactionId: code === 0 ? str(result.TransactionID ?? param("TransactionReceipt")) : null,
    amountKes: amount === undefined ? null : Math.round(Number(amount)),
    receiverName: str(param("ReceiverPartyPublicName")),
  };
}

/** Extract the IDs from a timeout notification, whatever its shape. */
export function parseB2CTimeout(body: unknown): {
  originatorConversationId: string | null;
  conversationId: string | null;
} {
  const text = JSON.stringify(body ?? {});
  const find = (key: string) => new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(text)?.[1] ?? null;
  return { originatorConversationId: find("OriginatorConversationID"), conversationId: find("ConversationID") };
}
