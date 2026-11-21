/**
 * Lipa Na M-Pesa Online (STK push) and STK Query: request building and
 * response interpretation. Pure functions; the HTTP happens in client.ts.
 */
import { MpesaError } from "./errors";
import { darajaTimestamp, stkPassword } from "./password";
import { normalizePhone } from "./phone";
import type { MpesaConfig, StkPushInput, StkQueryResult } from "./types";

/** Daraja field limits. Documented by Safaricom; confirm with Safaricom if they reject a request. */
export const ACCOUNT_REFERENCE_MAX = 12;
export const TRANSACTION_DESC_MAX = 13;

export type StkPushRequestBody = {
  BusinessShortCode: string;
  Password: string;
  Timestamp: string;
  TransactionType: MpesaConfig["transactionType"];
  Amount: number;
  PartyA: string;
  PartyB: string;
  PhoneNumber: string;
  CallBackURL: string;
  AccountReference: string;
  TransactionDesc: string;
};

export function buildStkPushRequest(config: MpesaConfig, input: StkPushInput, now: Date): StkPushRequestBody {
  if (!Number.isInteger(input.amountKes) || input.amountKes < 1) {
    throw new MpesaError("invalid_input", "The amount must be a whole number of shillings, at least KES 1.");
  }
  if (!input.callbackUrl.startsWith("https://") && config.mode !== "simulator") {
    // Daraja only calls public HTTPS URLs. Use a tunnel (see docs/02-mpesa-sandbox.md) for local sandbox testing.
    throw new MpesaError("invalid_input", "The M-Pesa callback URL must be a public https:// URL.");
  }
  const phone = normalizePhone(input.phone);
  const timestamp = darajaTimestamp(now);

  return {
    BusinessShortCode: config.shortcode,
    Password: stkPassword(config.shortcode, config.passkey, timestamp),
    Timestamp: timestamp,
    TransactionType: config.transactionType,
    Amount: input.amountKes,
    PartyA: phone,
    PartyB: config.partyB,
    PhoneNumber: phone,
    CallBackURL: input.callbackUrl,
    AccountReference: input.accountReference.slice(0, ACCOUNT_REFERENCE_MAX),
    TransactionDesc: input.description.slice(0, TRANSACTION_DESC_MAX),
  };
}

export function buildStkQueryRequest(config: MpesaConfig, checkoutRequestId: string, now: Date) {
  const timestamp = darajaTimestamp(now);
  return {
    BusinessShortCode: config.shortcode,
    Password: stkPassword(config.shortcode, config.passkey, timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };
}

/**
 * Daraja's errorCode when STK Query is asked about a push the customer hasn't
 * finished yet. It arrives as an HTTP error, not a result. Commonly observed
 * value; confirm with Safaricom.
 */
export const STK_QUERY_STILL_PROCESSING = "500.001.1001";

/** Turn a query error into "pending" when it only means "not finished yet". Re-throws anything else. */
export function stkQueryErrorToResult(error: unknown): StkQueryResult {
  if (error instanceof MpesaError && error.daraja?.errorCode === STK_QUERY_STILL_PROCESSING) {
    return { state: "pending", raw: error.daraja };
  }
  throw error;
}
