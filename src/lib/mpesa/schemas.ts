/**
 * Zod schemas for everything Daraja sends us. Never trust the shape of an
 * external payload: parse it, and handle the failure.
 *
 * Daraja is inconsistent about number vs string (e.g. ResultCode is a number
 * in callbacks but sometimes a string in STK Query), so numeric fields coerce.
 */
import { z } from "zod";

const numeric = z.union([z.number(), z.string().regex(/^-?\d+$/)]).transform(Number);

export const oauthResponseSchema = z.object({
  access_token: z.string().min(1),
  // Daraja returns seconds as a string, e.g. "3599".
  expires_in: numeric,
});

/** Error body Daraja returns on 4xx/5xx, e.g. { requestId, errorCode: "400.002.02", errorMessage }. */
export const darajaErrorSchema = z.object({
  requestId: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});

export const stkPushResponseSchema = z.object({
  MerchantRequestID: z.string().min(1),
  CheckoutRequestID: z.string().min(1),
  ResponseCode: z.coerce.string(),
  ResponseDescription: z.string().optional(),
  CustomerMessage: z.string().optional(),
});

export const stkQueryResponseSchema = z.object({
  ResponseCode: z.coerce.string(),
  ResponseDescription: z.string().optional(),
  MerchantRequestID: z.string().optional(),
  CheckoutRequestID: z.string().optional(),
  ResultCode: numeric,
  ResultDesc: z.string().default(""),
});

const metadataItemSchema = z.object({
  Name: z.string(),
  // "Balance" arrives with no Value at all.
  Value: z.union([z.string(), z.number()]).optional(),
});

/** The body Daraja POSTs to the STK callback URL. */
export const stkCallbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string(),
      CheckoutRequestID: z.string().min(1),
      ResultCode: numeric,
      ResultDesc: z.string().default(""),
      CallbackMetadata: z.object({ Item: z.array(metadataItemSchema) }).optional(),
    }),
  }),
});

export type StkCallbackPayload = z.infer<typeof stkCallbackSchema>;

/** The useful fields of an STK callback, flattened. */
export type ParsedStkCallback = {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  /** Present on success only. */
  amountKes?: number;
  receipt?: string;
  phone?: string;
  /** YYYYMMDDHHmmss in Kenya time, as Daraja sends it. */
  transactionDate?: string;
};

/** Parse and flatten an STK callback. Throws a ZodError if the shape is wrong. */
export function parseStkCallback(body: unknown): ParsedStkCallback {
  const cb = stkCallbackSchema.parse(body).Body.stkCallback;
  const items = new Map((cb.CallbackMetadata?.Item ?? []).map((i) => [i.Name, i.Value]));
  const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
  const amount = items.get("Amount");

  return {
    merchantRequestId: cb.MerchantRequestID,
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: cb.ResultCode,
    resultDesc: cb.ResultDesc,
    // Amounts are whole shillings for STK, but guard against "1.00".
    amountKes: amount === undefined ? undefined : Math.round(Number(amount)),
    receipt: str(items.get("MpesaReceiptNumber")),
    phone: str(items.get("PhoneNumber")),
    transactionDate: str(items.get("TransactionDate")),
  };
}
