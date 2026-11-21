import { describe, expect, it, vi } from "vitest";
import { createDarajaClient } from "@/lib/mpesa/client";
import { MpesaError } from "@/lib/mpesa/errors";
import type { MpesaConfig } from "@/lib/mpesa";

const config: MpesaConfig = {
  mode: "sandbox",
  consumerKey: "key",
  consumerSecret: "secret",
  shortcode: "174379",
  passkey: "passkey",
  transactionType: "CustomerPayBillOnline",
  partyB: "174379",
  timeoutMs: 1_000,
};

const pushInput = {
  phone: "0712345678",
  amountKes: 1500,
  accountReference: "LKABCD2345",
  description: "LipaKit",
  callbackUrl: "https://app.example.co.ke/api/hooks/tok/stk",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const tokenResponse = () => json(200, { access_token: "tok-1", expires_in: "3599" });
const pushOk = () =>
  json(200, {
    MerchantRequestID: "29115-1",
    CheckoutRequestID: "ws_CO_1",
    ResponseCode: "0",
    ResponseDescription: "Success. Request accepted for processing",
    CustomerMessage: "Success. Request accepted for processing",
  });

/** A fetch mock that routes by URL path. */
function router(routes: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    void _init;
    const path = new URL(String(input)).pathname;
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected request to ${path}`);
    return handler();
  });
}

describe("Daraja client", () => {
  it("sends a correct STK push and parses the response", async () => {
    const fetch = router({ "/oauth/v1/generate": tokenResponse, "/mpesa/stkpush/v1/processrequest": pushOk });
    const client = createDarajaClient(config, { fetch, now: () => new Date("2026-11-21T09:00:00Z") });

    const result = await client.stkPush(pushInput);
    expect(result).toMatchObject({ checkoutRequestId: "ws_CO_1", merchantRequestId: "29115-1", phone: "254712345678" });

    const [url, init] = fetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      BusinessShortCode: "174379",
      Timestamp: "20261121120000",
      TransactionType: "CustomerPayBillOnline",
      Amount: 1500,
      PartyA: "254712345678",
      PartyB: "174379",
      PhoneNumber: "254712345678",
      AccountReference: "LKABCD2345",
    });
    expect(Buffer.from(body.Password, "base64").toString()).toBe("174379passkey20261121120000");
  });

  it("caches the OAuth token across calls", async () => {
    const fetch = router({ "/oauth/v1/generate": tokenResponse, "/mpesa/stkpush/v1/processrequest": pushOk });
    const client = createDarajaClient(config, { fetch });
    await client.stkPush(pushInput);
    await client.stkPush(pushInput);
    const tokenCalls = fetch.mock.calls.filter(([u]) => String(u).includes("/oauth/"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("refreshes the token once it is about to expire", async () => {
    let now = new Date("2026-11-21T09:00:00Z");
    const fetch = router({ "/oauth/v1/generate": tokenResponse, "/mpesa/stkpush/v1/processrequest": pushOk });
    const client = createDarajaClient(config, { fetch, now: () => now });
    await client.stkPush(pushInput);
    now = new Date(now.getTime() + 3_560_000); // within the 60s safety margin of 3599s
    await client.stkPush(pushInput);
    expect(fetch.mock.calls.filter(([u]) => String(u).includes("/oauth/"))).toHaveLength(2);
  });

  it("retries once with a fresh token after a 401", async () => {
    let pushCalls = 0;
    const fetch = router({
      "/oauth/v1/generate": tokenResponse,
      "/mpesa/stkpush/v1/processrequest": () =>
        ++pushCalls === 1 ? json(401, { errorCode: "404.001.03", errorMessage: "Invalid Access Token" }) : pushOk(),
    });
    const client = createDarajaClient(config, { fetch });
    await expect(client.stkPush(pushInput)).resolves.toMatchObject({ checkoutRequestId: "ws_CO_1" });
    expect(pushCalls).toBe(2);
  });

  it("maps a Daraja 400 to a readable rejected error, keeping the details", async () => {
    const fetch = router({
      "/oauth/v1/generate": tokenResponse,
      "/mpesa/stkpush/v1/processrequest": () =>
        json(400, {
          requestId: "r1",
          errorCode: "400.002.02",
          errorMessage: "Bad Request - Invalid BusinessShortCode",
        }),
    });
    const err = await createDarajaClient(config, { fetch })
      .stkPush(pushInput)
      .catch((e) => e);
    expect(err).toBeInstanceOf(MpesaError);
    expect(err.code).toBe("rejected");
    expect(err.daraja.errorCode).toBe("400.002.02");
    expect(err.message).toContain("Invalid BusinessShortCode");
  });

  it("maps a hung request to a timeout error", async () => {
    const fetch = vi.fn(
      (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
        ),
    );
    const err = await createDarajaClient({ ...config, timeoutMs: 20 }, { fetch })
      .stkPush(pushInput)
      .catch((e) => e);
    expect(err).toBeInstanceOf(MpesaError);
    expect(err.code).toBe("timeout");
  });

  it("refuses invalid input before calling Daraja", async () => {
    const fetch = router({ "/oauth/v1/generate": tokenResponse });
    const client = createDarajaClient(config, { fetch });
    await expect(client.stkPush({ ...pushInput, phone: "12345" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(client.stkPush({ ...pushInput, amountKes: 0 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(client.stkPush({ ...pushInput, callbackUrl: "http://localhost/cb" })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  it("reports a still-processing STK Query as pending, not an error", async () => {
    const fetch = router({
      "/oauth/v1/generate": tokenResponse,
      "/mpesa/stkpushquery/v1/query": () =>
        json(500, { errorCode: "500.001.1001", errorMessage: "The transaction is being processed" }),
    });
    await expect(createDarajaClient(config, { fetch }).stkQuery("ws_CO_1")).resolves.toMatchObject({
      state: "pending",
    });
  });

  it("returns the final result from STK Query, coercing a string ResultCode", async () => {
    const fetch = router({
      "/oauth/v1/generate": tokenResponse,
      "/mpesa/stkpushquery/v1/query": () =>
        json(200, { ResponseCode: "0", ResultCode: "1032", ResultDesc: "Request cancelled by user" }),
    });
    await expect(createDarajaClient(config, { fetch }).stkQuery("ws_CO_1")).resolves.toMatchObject({
      state: "final",
      resultCode: 1032,
    });
  });
});
