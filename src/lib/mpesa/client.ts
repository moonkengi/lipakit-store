/**
 * The real Daraja client (sandbox and production). The simulator in
 * simulator.ts implements the same MpesaClient interface.
 */
import { createTokenProvider } from "./auth";
import { buildRegisterC2BRequest, C2B_REGISTER_PATH, registerC2BResponseSchema } from "./c2b";
import { MpesaError } from "./errors";
import { DARAJA_BASE_URLS, darajaRequest } from "./http";
import { buildStandingOrderRequest, RATIBA_PATH, standingOrderResponseSchema } from "./ratiba";
import { stkPushResponseSchema, stkQueryResponseSchema } from "./schemas";
import { buildStkPushRequest, buildStkQueryRequest, stkQueryErrorToResult } from "./stk";
import type { MpesaClient, MpesaConfig, MpesaDeps } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

export function createDarajaClient(config: MpesaConfig, deps: MpesaDeps = {}): MpesaClient {
  if (config.mode === "simulator") throw new Error("Use createSimulatorClient() for simulator mode.");

  const baseUrl = DARAJA_BASE_URLS[config.mode];
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tokens = createTokenProvider({
    baseUrl,
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    timeoutMs,
    fetch: fetchImpl,
    now,
  });

  /** POST with a bearer token. On 401 the cached token is dropped and the call retried once. */
  async function post<T extends Parameters<typeof darajaRequest>[0]["schema"]>(path: string, body: unknown, schema: T) {
    for (let attempt = 0; ; attempt++) {
      const token = await tokens.getToken();
      try {
        return await darajaRequest({
          url: `${baseUrl}${path}`,
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body,
          schema,
          timeoutMs,
          fetch: fetchImpl,
        });
      } catch (error) {
        if (attempt === 0 && error instanceof MpesaError && error.code === "auth") {
          tokens.clear();
          continue;
        }
        throw error;
      }
    }
  }

  return {
    mode: config.mode,

    async stkPush(input) {
      const body = buildStkPushRequest(config, input, now());
      const res = await post("/mpesa/stkpush/v1/processrequest", body, stkPushResponseSchema);
      if (res.ResponseCode !== "0") {
        throw new MpesaError(
          "rejected",
          res.CustomerMessage ?? res.ResponseDescription ?? "M-Pesa rejected the request.",
        );
      }
      return {
        merchantRequestId: res.MerchantRequestID,
        checkoutRequestId: res.CheckoutRequestID,
        customerMessage: res.CustomerMessage ?? "Check your phone to complete the payment.",
        phone: body.PhoneNumber,
        raw: res,
      };
    },

    async stkQuery(checkoutRequestId) {
      try {
        const res = await post(
          "/mpesa/stkpushquery/v1/query",
          buildStkQueryRequest(config, checkoutRequestId, now()),
          stkQueryResponseSchema,
        );
        return { state: "final", resultCode: res.ResultCode, resultDesc: res.ResultDesc, raw: res };
      } catch (error) {
        return stkQueryErrorToResult(error);
      }
    },

    async registerC2BUrls(input) {
      const res = await post(
        C2B_REGISTER_PATH,
        buildRegisterC2BRequest(config.partyB, input),
        registerC2BResponseSchema,
      );
      if (res.ResponseCode !== "0") {
        throw new MpesaError(
          "rejected",
          `M-Pesa rejected the URL registration: ${res.ResponseDescription ?? res.ResponseCode}`,
        );
      }
      return { description: res.ResponseDescription ?? "Success", raw: res };
    },

    async createStandingOrder(input) {
      const res = await post(RATIBA_PATH, buildStandingOrderRequest(config, input), standingOrderResponseSchema);
      // Daraja's docs show "200" for an accepted request. Confirm with Safaricom.
      if (!["0", "200"].includes(res.ResponseHeader.responseCode)) {
        throw new MpesaError(
          "rejected",
          `M-Pesa rejected the standing order: ${res.ResponseHeader.responseDescription ?? res.ResponseHeader.responseCode}`,
        );
      }
      return { requestRefId: res.ResponseHeader.responseRefID ?? "", raw: res };
    },
  };
}
