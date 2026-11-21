import { describe, expect, it, vi } from "vitest";
import { buildRegisterC2BRequest, findBannedKeyword, parseDarajaTime } from "@/lib/mpesa/c2b";
import { createDarajaClient } from "@/lib/mpesa/client";
import { buildStandingOrderRequest, parseRatibaCallback, ratibaDate } from "@/lib/mpesa/ratiba";
import { createSimulatorClient, listSimulatedStandingOrders, resetSimulator } from "@/lib/mpesa/simulator";
import type { MpesaConfig } from "@/lib/mpesa";

const paybill: MpesaConfig = {
  mode: "sandbox",
  consumerKey: "k",
  consumerSecret: "s",
  shortcode: "174379",
  passkey: "p",
  transactionType: "CustomerPayBillOnline",
  partyB: "174379",
};

describe("callback URL keywords Safaricom blocks", () => {
  it.each([
    ["https://app.example.co.ke/api/mpesa/callback/x", "mpesa"],
    ["https://M-PESA.example.com/x", "m-pesa"],
    ["https://safaricom-pay.example.com", "safaricom"],
    ["https://x.example.com/api/query", "query"],
  ])("flags %s", (url, word) => {
    expect(findBannedKeyword(url)).toBe(word);
  });

  it("accepts the kit's own callback paths", () => {
    expect(
      findBannedKeyword("https://app.example.co.ke/api/hooks/3f9a0c1b2d4e5f60718293a4b5c6d7e8f9a0b1c2/c2b/confirm"),
    ).toBeUndefined();
  });

  it("refuses to register a blocked URL before calling Daraja", () => {
    expect(() =>
      buildRegisterC2BRequest("174379", {
        confirmationUrl: "https://shop.example.com/mpesa/confirm",
        validationUrl: "https://shop.example.com/hooks/validate",
        responseType: "Completed",
      }),
    ).toThrow(/rejects callback URLs containing "mpesa"/);
  });
});

describe("C2B registration", () => {
  it("posts the URLs for the receiving shortcode", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/oauth/"))
        return new Response(JSON.stringify({ access_token: "t", expires_in: "3599" }));
      expect(String(input)).toBe("https://sandbox.safaricom.co.ke/mpesa/c2b/v1/registerurl");
      expect(JSON.parse(String(init?.body))).toEqual({
        ShortCode: "174379",
        ResponseType: "Completed",
        ConfirmationURL: "https://app.example.co.ke/api/hooks/tok/c2b/confirm",
        ValidationURL: "https://app.example.co.ke/api/hooks/tok/c2b/validate",
      });
      return new Response(JSON.stringify({ ResponseCode: "0", ResponseDescription: "Success" }));
    });
    const res = await createDarajaClient(paybill, { fetch }).registerC2BUrls({
      confirmationUrl: "https://app.example.co.ke/api/hooks/tok/c2b/confirm",
      validationUrl: "https://app.example.co.ke/api/hooks/tok/c2b/validate",
      responseType: "Completed",
    });
    expect(res.description).toBe("Success");
  });
});

describe("parseDarajaTime", () => {
  it("reads YYYYMMDDHHmmss as Kenya time", () => {
    expect(parseDarajaTime("20261121120000")).toEqual(new Date("2026-11-21T09:00:00Z"));
    expect(parseDarajaTime("20270101013000")).toEqual(new Date("2026-12-31T22:30:00Z"));
  });
});

describe("Ratiba", () => {
  const input = {
    name: "LipaKit Pro LKSABC",
    phone: "0712345678",
    amountKes: 1500,
    startDate: new Date("2026-12-21T09:00:00Z"),
    endDate: new Date("2031-12-21T09:00:00Z"),
    frequency: "monthly" as const,
    accountReference: "LKSABCDEFGH",
    description: "LipaKit",
    callbackUrl: "https://app.example.co.ke/api/hooks/tok/ratiba",
  };

  it("builds a Paybill standing order with Daraja's codes", () => {
    expect(buildStandingOrderRequest(paybill, input)).toEqual({
      StandingOrderName: "LipaKit Pro LKSABC",
      StartDate: "20261221",
      EndDate: "20311221",
      BusinessShortCode: "174379",
      TransactionType: "Standing Order Customer Pay Bill",
      ReceiverPartyIdentifierType: "4",
      Amount: "1500",
      PartyA: "254712345678",
      CallBackURL: "https://app.example.co.ke/api/hooks/tok/ratiba",
      AccountReference: "LKSABCDEFGH",
      TransactionDesc: "LipaKit",
      Frequency: "4",
    });
  });

  it("uses Buy Goods codes for a Till", () => {
    const req = buildStandingOrderRequest(
      { ...paybill, transactionType: "CustomerBuyGoodsOnline", partyB: "5544332" },
      input,
    );
    expect(req).toMatchObject({
      BusinessShortCode: "5544332",
      TransactionType: "Standing Order Customer Pay Marchant",
      ReceiverPartyIdentifierType: "2",
    });
  });

  it("uses the Kenya date at night (UTC is still the day before)", () => {
    expect(ratibaDate(new Date("2026-12-20T22:00:00Z"))).toBe("20261221");
  });

  it("parses both documented callback shapes", () => {
    const camel = {
      responseHeader: { responseRefID: "ref-1", requestRefID: "req-1", responseCode: "0", responseDescription: "ok" },
      responseBody: {
        responseData: [
          { Name: "responseCode", Value: "0" },
          { Name: "Status", Value: "OKAY" },
        ],
      },
    };
    expect(parseRatibaCallback(camel)).toMatchObject({ requestRefId: "req-1", ok: true, code: "0" });

    const failure = {
      ResponseHeader: { responseRefID: "ref-2", responseCode: "1037", responseDescription: "Error" },
      ResponseBody: { responseData: [{ Name: "ResultCode", Value: "3001" }] },
    };
    expect(parseRatibaCallback(failure)).toMatchObject({ requestRefId: "ref-2", ok: false, code: "3001" });
  });

  it("simulator: creates the order and sends an approval callback", async () => {
    resetSimulator();
    const fetch = vi.fn(async () => new Response("{}"));
    let scheduled: (() => void) | undefined;
    const sim = createSimulatorClient({ fetch, schedule: (fn) => (scheduled = fn) });
    const res = await sim.createStandingOrder(input);
    expect(listSimulatedStandingOrders()[0]).toMatchObject({ accountReference: "LKSABCDEFGH", amountKes: 1500 });
    scheduled?.();
    await new Promise((r) => setTimeout(r, 0));
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(parseRatibaCallback(body)).toMatchObject({ ok: true, requestRefId: res.requestRefId });
  });
});
