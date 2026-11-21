/** The app's M-Pesa client, configured from env vars, and its callback URLs. */
import "server-only";
import { getServerEnv } from "@/lib/env";
import { createMpesaClient, createPaystackClient, type MpesaClient, type MpesaConfig } from "@/lib/mpesa";

/**
 * Safaricom's public sandbox Paybill. Used for simulator mode so you can run
 * the app with no credentials at all.
 */
const SANDBOX_SHORTCODE = "174379";

let client: MpesaClient | undefined;

export function mpesaConfigFromEnv(): MpesaConfig {
  const env = getServerEnv();
  const isTill = env.MPESA_TILL_OR_PAYBILL === "till";
  const shortcode = env.MPESA_SHORTCODE ?? SANDBOX_SHORTCODE;
  return {
    mode: env.MPESA_MODE,
    // Env validation guarantees these are set outside simulator mode.
    consumerKey: env.MPESA_CONSUMER_KEY ?? "",
    consumerSecret: env.MPESA_CONSUMER_SECRET ?? "",
    shortcode,
    passkey: env.MPESA_PASSKEY ?? "",
    transactionType: isTill ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
    partyB: isTill ? (env.MPESA_TILL_NUMBER ?? shortcode) : shortcode,
    b2c:
      env.MPESA_B2C_INITIATOR && env.MPESA_B2C_SECURITY_CREDENTIAL
        ? {
            initiatorName: env.MPESA_B2C_INITIATOR,
            securityCredential: env.MPESA_B2C_SECURITY_CREDENTIAL,
            shortcode: env.MPESA_B2C_SHORTCODE ?? shortcode,
          }
        : undefined,
  };
}

/** Payouts are available when B2C credentials are set, or always in simulator mode. */
export function b2cEnabled(): boolean {
  const env = getServerEnv();
  if (usingPaystack()) return false;
  return env.MPESA_MODE === "simulator" || Boolean(env.MPESA_B2C_INITIATOR && env.MPESA_B2C_SECURITY_CREDENTIAL);
}

/** One client per server process, so the OAuth token cache is shared. */
export function getMpesaClient(): MpesaClient {
  client ??= usingPaystack()
    ? createPaystackClient({ secretKey: getServerEnv().PAYSTACK_SECRET_KEY! })
    : createMpesaClient(mpesaConfigFromEnv());
  return client;
}

/** True when real payments go through Paystack instead of your own Daraja shortcode. */
export function usingPaystack(): boolean {
  const env = getServerEnv();
  return env.MPESA_MODE !== "simulator" && env.PAYMENT_PROVIDER === "paystack";
}

export type CallbackKind =
  "stk" | "c2b/confirm" | "c2b/validate" | "ratiba" | "b2c/result" | "b2c/timeout" | "paystack";

/**
 * Full public URL Daraja should call, including the secret path token.
 * The path is /api/hooks/... on purpose: Safaricom rejects callback URLs that
 * contain words like "mpesa" or "safaricom" (see lib/mpesa/c2b.ts).
 */
export function callbackUrl(kind: CallbackKind): string {
  const env = getServerEnv();
  return `${env.NEXT_PUBLIC_SITE_URL}/api/hooks/${env.MPESA_CALLBACK_TOKEN}/${kind}`;
}
