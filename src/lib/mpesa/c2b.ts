/**
 * C2B (Paybill / Till): URL registration, and the validation and confirmation
 * payloads Daraja POSTs when a customer pays your shortcode directly.
 *
 * Confirmations are unsigned and, unlike STK, can't be re-checked with a query
 * API without extra credentials (Transaction Status). Protection comes from the
 * secret path token, optional IP allowlisting, and TransID uniqueness.
 */
import { z } from "zod";
import { MpesaError } from "./errors";

/**
 * Safaricom refuses callback URLs containing these words (any case). From
 * Daraja's C2B docs; we check every URL we register so the failure is clear.
 */
export const BANNED_URL_KEYWORDS = ["m-pesa", "mpesa", "safaricom", "exe", "exec", "cmd", "sql", "query"] as const;

export function findBannedKeyword(url: string): string | undefined {
  const lower = url.toLowerCase();
  return BANNED_URL_KEYWORDS.find((k) => lower.includes(k));
}

export function assertDarajaSafeUrl(url: string): void {
  const word = findBannedKeyword(url);
  if (word) {
    throw new MpesaError(
      "invalid_input",
      `Safaricom rejects callback URLs containing "${word}". Change the domain or path: ${url}`,
    );
  }
}

export type C2BResponseType = "Completed" | "Cancelled";

export type RegisterC2BInput = {
  confirmationUrl: string;
  validationUrl: string;
  /** What M-Pesa does if your validation URL can't be reached. */
  responseType: C2BResponseType;
};

/**
 * v1 sends the payer's phone number in plain form; v2 masks it, which makes
 * phone-based matching impossible. We use v1. Confirm with Safaricom which
 * version your shortcode supports.
 */
export const C2B_REGISTER_PATH = "/mpesa/c2b/v1/registerurl";

export function buildRegisterC2BRequest(shortcode: string, input: RegisterC2BInput) {
  assertDarajaSafeUrl(input.confirmationUrl);
  assertDarajaSafeUrl(input.validationUrl);
  return {
    ShortCode: shortcode,
    ResponseType: input.responseType,
    ConfirmationURL: input.confirmationUrl,
    ValidationURL: input.validationUrl,
  };
}

export const registerC2BResponseSchema = z.object({
  OriginatorCoversationID: z.string().optional(), // sic: Daraja's spelling
  ResponseCode: z.coerce.string(),
  ResponseDescription: z.string().optional(),
});

/** Same body for validation and confirmation. Amounts arrive as strings like "1500.00". */
export const c2bPayloadSchema = z.object({
  TransactionType: z.string().optional(),
  TransID: z.string().min(1),
  TransTime: z.string().regex(/^\d{14}$/),
  TransAmount: z.union([z.string(), z.number()]),
  BusinessShortCode: z.coerce.string(),
  BillRefNumber: z.string().default(""),
  InvoiceNumber: z.string().optional(),
  OrgAccountBalance: z.union([z.string(), z.number()]).optional(),
  ThirdPartyTransID: z.string().optional(),
  MSISDN: z.coerce.string().default(""),
  FirstName: z.string().optional(),
  MiddleName: z.string().optional(),
  LastName: z.string().optional(),
});

export type ParsedC2BPayment = {
  transId: string;
  /** Whole shillings. */
  amountKes: number;
  /** Trimmed and upper-cased: customers type account numbers inconsistently. */
  accountRef: string;
  /** 2547XXXXXXXX when Daraja sends it plainly; otherwise whatever it sent (masked or hashed), or null. */
  phone: string | null;
  phoneIsPlain: boolean;
  shortcode: string;
  paidAt: Date;
  payerName: string;
};

/** Daraja's YYYYMMDDHHmmss in Kenya time (UTC+3) → Date. */
export function parseDarajaTime(value: string): Date {
  const [y, mo, d, h, mi, s] = [0, 4, 6, 8, 10, 12].map((i, n) => Number(value.slice(i, n === 0 ? 4 : i + 2)));
  return new Date(Date.UTC(y, mo - 1, d, h - 3, mi, s));
}

export function parseC2BPayload(body: unknown): ParsedC2BPayment {
  const p = c2bPayloadSchema.parse(body);
  const phone = p.MSISDN.trim();
  const phoneIsPlain = /^254[17]\d{8}$/.test(phone);
  return {
    transId: p.TransID.trim(),
    amountKes: Math.round(Number(p.TransAmount)),
    accountRef: p.BillRefNumber.trim().toUpperCase(),
    phone: phone || null,
    phoneIsPlain,
    shortcode: p.BusinessShortCode,
    paidAt: parseDarajaTime(p.TransTime),
    payerName: [p.FirstName, p.MiddleName, p.LastName].filter(Boolean).join(" "),
  };
}

/** Responses Daraja expects from the validation URL. */
export const C2B_ACCEPT = { ResultCode: "0", ResultDesc: "Accepted" } as const;
/** "Invalid Account Number". Other rejection codes exist; confirm with Safaricom. */
export const C2B_REJECT_ACCOUNT = { ResultCode: "C2B00012", ResultDesc: "Rejected" } as const;
