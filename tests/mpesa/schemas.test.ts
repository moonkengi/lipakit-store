import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { parseStkCallback } from "@/lib/mpesa";

// Shapes as Daraja sends them (values are made up).
const success = {
  Body: {
    stkCallback: {
      MerchantRequestID: "29115-34620561-1",
      CheckoutRequestID: "ws_CO_191220191020363925",
      ResultCode: 0,
      ResultDesc: "The service request is processed successfully.",
      CallbackMetadata: {
        Item: [
          { Name: "Amount", Value: 1500 },
          { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
          { Name: "Balance" },
          { Name: "TransactionDate", Value: 20191219102115 },
          { Name: "PhoneNumber", Value: 254708374149 },
        ],
      },
    },
  },
};

const cancelled = {
  Body: {
    stkCallback: {
      MerchantRequestID: "29115-34620561-1",
      CheckoutRequestID: "ws_CO_191220191020363925",
      ResultCode: 1032,
      ResultDesc: "Request cancelled by user",
    },
  },
};

describe("parseStkCallback", () => {
  it("flattens a success callback", () => {
    expect(parseStkCallback(success)).toEqual({
      merchantRequestId: "29115-34620561-1",
      checkoutRequestId: "ws_CO_191220191020363925",
      resultCode: 0,
      resultDesc: "The service request is processed successfully.",
      amountKes: 1500,
      receipt: "NLJ7RT61SV",
      phone: "254708374149",
      transactionDate: "20191219102115",
    });
  });

  it("parses a failure callback without metadata", () => {
    const cb = parseStkCallback(cancelled);
    expect(cb.resultCode).toBe(1032);
    expect(cb.receipt).toBeUndefined();
    expect(cb.amountKes).toBeUndefined();
  });

  it("accepts ResultCode as a string", () => {
    const body = structuredClone(cancelled) as { Body: { stkCallback: { ResultCode: unknown } } };
    body.Body.stkCallback.ResultCode = "1032";
    expect(parseStkCallback(body).resultCode).toBe(1032);
  });

  it("rounds a decimal amount", () => {
    const body = structuredClone(success);
    body.Body.stkCallback.CallbackMetadata.Item[0] = { Name: "Amount", Value: 1500.0 };
    expect(parseStkCallback(body).amountKes).toBe(1500);
  });

  it.each([null, {}, { Body: {} }, { Body: { stkCallback: { ResultCode: 0 } } }, "not json"])(
    "rejects malformed payload %j",
    (payload) => {
      expect(() => parseStkCallback(payload)).toThrow(ZodError);
    },
  );
});
