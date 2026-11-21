/**
 * M-Pesa Ratiba (standing orders): a customer approves recurring payments to
 * your shortcode once, and M-Pesa pays on schedule without a prompt each time.
 *
 * Field names and codes follow Daraja's Ratiba docs, which are thin and in
 * places inconsistent. Two things to confirm with Safaricom before relying on it:
 *  - how each recurring payment reaches you. We assume it arrives at your
 *    Paybill/Till as a normal C2B confirmation whose BillRefNumber is the
 *    standing order's AccountReference (that's how we match it);
 *  - the exact callback fields (docs show both `ResultCode` and `responseCode`).
 * Production access needs approval from Safaricom after sandbox testing.
 */
import { z } from "zod";
import { assertDarajaSafeUrl } from "./c2b";
import { MpesaError } from "./errors";
import { normalizePhone } from "./phone";
import type { MpesaConfig } from "./types";

export const RATIBA_PATH = "/standingorder/v1/createStandingOrderExternal";

export type RatibaFrequency =
  "one_off" | "daily" | "weekly" | "monthly" | "bi_monthly" | "quarterly" | "half_year" | "yearly";

const frequencyCodes: Record<RatibaFrequency, string> = {
  one_off: "1",
  daily: "2",
  weekly: "3",
  monthly: "4",
  bi_monthly: "5",
  quarterly: "6",
  half_year: "7",
  yearly: "8",
};

export type StandingOrderInput = {
  /** Must be unique per customer. */
  name: string;
  phone: string;
  amountKes: number;
  /** First payment date (Kenya date). */
  startDate: Date;
  /** Last possible payment date. */
  endDate: Date;
  frequency: RatibaFrequency;
  /** Max 12 characters. Recurring payments are matched back to the subscription by this. */
  accountReference: string;
  /** Max 13 characters. */
  description: string;
  callbackUrl: string;
};

export type StandingOrderResult = { requestRefId: string; raw: unknown };

/** Kenya-time date as yyyymmdd. */
export function ratibaDate(date: Date): string {
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return eat.toISOString().slice(0, 10).replaceAll("-", "");
}

export function buildStandingOrderRequest(config: MpesaConfig, input: StandingOrderInput) {
  if (!Number.isInteger(input.amountKes) || input.amountKes < 1) {
    throw new MpesaError("invalid_input", "The standing order amount must be a whole number of shillings.");
  }
  if (input.endDate <= input.startDate) {
    throw new MpesaError("invalid_input", "The standing order must end after it starts.");
  }
  assertDarajaSafeUrl(input.callbackUrl);
  const isTill = config.transactionType === "CustomerBuyGoodsOnline";
  return {
    StandingOrderName: input.name.slice(0, 64),
    StartDate: ratibaDate(input.startDate),
    EndDate: ratibaDate(input.endDate),
    BusinessShortCode: config.partyB,
    // Spelling of "Marchant" is Daraja's own.
    TransactionType: isTill ? "Standing Order Customer Pay Marchant" : "Standing Order Customer Pay Bill",
    ReceiverPartyIdentifierType: isTill ? "2" : "4",
    Amount: String(input.amountKes),
    PartyA: normalizePhone(input.phone),
    CallBackURL: input.callbackUrl,
    AccountReference: input.accountReference.slice(0, 12),
    TransactionDesc: input.description.slice(0, 13),
    Frequency: frequencyCodes[input.frequency],
  };
}

/** The synchronous answer: Daraja accepted the request and will prompt the customer. */
export const standingOrderResponseSchema = z.object({
  ResponseHeader: z.object({
    responseRefID: z.string().optional(),
    responseCode: z.coerce.string(),
    responseDescription: z.string().optional(),
  }),
});

export type ParsedRatibaCallback = {
  requestRefId: string | null;
  /** "0" means the customer approved and the standing order exists. */
  ok: boolean;
  code: string;
  description: string;
};

/**
 * The callback after the customer approves (or doesn't). Parsed leniently:
 * Daraja's docs show `responseHeader`/`ResponseHeader`, and `ResultCode` or
 * `responseCode` inside `responseData`.
 */
export function parseRatibaCallback(body: unknown): ParsedRatibaCallback {
  const root = (body ?? {}) as Record<string, unknown>;
  const pick = (obj: unknown, ...keys: string[]): unknown => {
    if (!obj || typeof obj !== "object") return undefined;
    const rec = obj as Record<string, unknown>;
    const key = Object.keys(rec).find((k) => keys.some((want) => want.toLowerCase() === k.toLowerCase()));
    return key ? rec[key] : undefined;
  };
  const header = pick(root, "responseHeader");
  const bodyPart = pick(root, "responseBody");
  const data = pick(bodyPart, "responseData");
  const items = Array.isArray(data) ? (data as { Name?: string; Value?: unknown }[]) : [];
  const item = (name: string) => items.find((i) => i.Name?.toLowerCase() === name.toLowerCase())?.Value;

  const code = String(item("ResultCode") ?? item("responseCode") ?? pick(header, "responseCode") ?? "");
  if (!code) throw new MpesaError("invalid_response", "Ratiba callback has no result code.");
  const ref = pick(header, "requestRefID") ?? pick(header, "responseRefID");
  return {
    requestRefId: ref === undefined ? null : String(ref),
    ok: code === "0",
    code,
    description: String(pick(header, "responseDescription") ?? item("Status") ?? ""),
  };
}
