/**
 * Paystack as the M-Pesa provider, for when you don't have your own Paybill or
 * Till yet. Paystack sends the STK push from its own shortcode and settles to
 * your bank or M-Pesa account (Paystack charges its fee, 1.5% for M-Pesa in
 * Kenya at the time of writing; check their pricing).
 *
 * It implements the same MpesaClient interface as Daraja, so checkout,
 * settlement, the poller and the UI don't change:
 *   stkPush  → POST /charge with mobile_money { provider: "mpesa" }
 *   stkQuery → GET /transaction/verify/:reference   (the source of truth)
 * Paystack's charge.success webhook is only a hint, exactly like a Daraja
 * callback: settlement always re-verifies.
 *
 * Not available through Paystack: C2B (Paybill menu payments to your own
 * number), Ratiba standing orders and B2C payouts. They need a Daraja shortcode.
 *
 * Status names and gateway messages are from Paystack's public docs and
 * observed behaviour; confirm edge cases with Paystack (techsupport@paystack.com).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { MpesaError } from "./errors";
import { normalizePhone } from "./phone";
import type { MpesaClient, MpesaDeps, StkPushInput, StkPushResult, StkQueryResult } from "./types";

export const PAYSTACK_BASE_URL = "https://api.paystack.co";

export type PaystackConfig = {
  /** sk_test_... or sk_live_... Never expose it to the browser. */
  secretKey: string;
  timeoutMs?: number;
};

/** Result codes used for Paystack failures, mapped onto the Daraja codes the rest of the kit understands. */
export const PAYSTACK_RESULT = {
  success: 0,
  insufficientFunds: 1,
  cancelled: 1032,
  unreachable: 1037,
  wrongPin: 2001,
  /** Any other failure. Not a Daraja code; shown as a generic "didn't go through". */
  failed: 9001,
} as const;

type PaystackBody = { status?: boolean; message?: string; data?: Record<string, unknown> | null };

const STILL_GOING = new Set(["pending", "ongoing", "processing", "queued", "pay_offline", "send_otp", "abandoned"]);

export function createPaystackClient(config: PaystackConfig, deps: MpesaDeps = {}): MpesaClient {
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const mode = config.secretKey.startsWith("sk_live_") ? "production" : "sandbox";

  async function call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ http: number; json: PaystackBody }> {
    let res: Response;
    try {
      res = await doFetch(`${PAYSTACK_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      if (cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
        throw new MpesaError("timeout", "M-Pesa took too long to respond. Please try again.", { cause });
      }
      throw new MpesaError("network", "We couldn't reach the payment provider. Please try again.", { cause });
    }
    let json: PaystackBody;
    try {
      json = (await res.json()) as PaystackBody;
    } catch (cause) {
      throw new MpesaError("invalid_response", "The payment provider sent a response we couldn't read.", {
        httpStatus: res.status,
        cause,
      });
    }
    if (res.status === 401) {
      throw new MpesaError("auth", "Paystack rejected the secret key. Check PAYSTACK_SECRET_KEY.", {
        httpStatus: 401,
      });
    }
    return { http: res.status, json };
  }

  return {
    mode,

    async stkPush(input: StkPushInput): Promise<StkPushResult> {
      const phone = normalizePhone(input.phone);
      if (!Number.isInteger(input.amountKes) || input.amountKes < 1) {
        throw new MpesaError("invalid_input", "Amount must be a whole number of shillings, at least KES 1.");
      }
      if (!input.email) {
        throw new MpesaError("invalid_input", "An email address is needed to pay through Paystack.");
      }
      // Unique per attempt; the account reference stays readable at the front.
      const reference = `${input.accountReference}-${randomBytes(4).toString("hex")}`;
      const { http, json } = await call("POST", "/charge", {
        email: input.email,
        amount: input.amountKes * 100, // Paystack amounts are in cents
        currency: "KES",
        reference,
        mobile_money: { phone: `+${phone}`, provider: "mpesa" },
        metadata: { account_reference: input.accountReference, description: input.description },
      });
      const status = typeof json.data?.status === "string" ? json.data.status : undefined;
      if (http >= 400 || json.status === false || status === "failed") {
        const why = String(json.data?.gateway_response ?? json.data?.message ?? json.message ?? "Request rejected");
        throw new MpesaError("rejected", `The M-Pesa prompt couldn't be sent: ${why}`, { httpStatus: http });
      }
      return {
        merchantRequestId: reference,
        checkoutRequestId: reference,
        customerMessage:
          typeof json.data?.display_text === "string"
            ? json.data.display_text
            : "Check your phone and enter your M-Pesa PIN to complete the payment.",
        phone,
        raw: json,
      };
    },

    async stkQuery(reference: string): Promise<StkQueryResult> {
      const { http, json } = await call("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
      // Not visible yet (or never created): keep waiting; the poller expires it after 10 minutes.
      if (http === 404 || !json.data) return { state: "pending", raw: json };
      return interpretPaystackTransaction(json.data, json);
    },

    async registerC2BUrls() {
      throw unsupported("Paybill (C2B) notifications");
    },
    async createStandingOrder() {
      throw unsupported("M-Pesa Ratiba standing orders");
    },
    async b2cPayment() {
      throw unsupported("B2C payouts");
    },
  };
}

function unsupported(what: string): MpesaError {
  return new MpesaError(
    "invalid_input",
    `${what} aren't available through Paystack. They need your own Daraja shortcode (docs/03-mpesa-go-live.md).`,
  );
}

/** Turn a Paystack transaction into the kit's pending/final result. Exported for tests. */
export function interpretPaystackTransaction(data: Record<string, unknown>, raw: unknown): StkQueryResult {
  const status = String(data.status ?? "");
  if (STILL_GOING.has(status)) return { state: "pending", raw };

  const gateway = String(data.gateway_response ?? data.message ?? status);
  if (status === "success") {
    const amount = typeof data.amount === "number" ? data.amount / 100 : undefined;
    const receipt = typeof data.receipt_number === "string" && data.receipt_number ? data.receipt_number : undefined;
    return {
      state: "final",
      resultCode: PAYSTACK_RESULT.success,
      resultDesc: gateway,
      amountKes: amount,
      // The M-Pesa receipt when Paystack provides it, otherwise Paystack's own reference.
      receipt: receipt ?? String(data.reference ?? ""),
      raw,
    };
  }
  return { state: "final", resultCode: failureCode(gateway), resultDesc: gateway, raw };
}

function failureCode(message: string): number {
  const m = message.toLowerCase();
  if (/cancel|declined by (the )?(user|customer)/.test(m)) return PAYSTACK_RESULT.cancelled;
  if (/insufficient|balance/.test(m)) return PAYSTACK_RESULT.insufficientFunds;
  if (/pin/.test(m)) return PAYSTACK_RESULT.wrongPin;
  if (/timed? ?out|unreachable|no response/.test(m)) return PAYSTACK_RESULT.unreachable;
  return PAYSTACK_RESULT.failed;
}

/**
 * Paystack signs webhooks with HMAC-SHA512 of the raw body, keyed with your
 * secret key, in the x-paystack-signature header (hex).
 */
export function verifyPaystackSignature(rawBody: string, signature: string | null, secretKey: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
