/** The app's M-Pesa client, configured from env vars, and its callback URLs. */
import "server-only";
import { getServerEnv } from "@/lib/env";
import { createMpesaClient, type MpesaClient, type MpesaConfig } from "@/lib/mpesa";

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
  };
}

/** One client per server process, so the OAuth token cache is shared. */
export function getMpesaClient(): MpesaClient {
  client ??= createMpesaClient(mpesaConfigFromEnv());
  return client;
}

export type CallbackKind = "stk" | "c2b/validate" | "c2b/confirm";

/** Full public URL Daraja should call, including the secret path token. */
export function callbackUrl(kind: CallbackKind): string {
  const env = getServerEnv();
  return `${env.NEXT_PUBLIC_SITE_URL}/api/mpesa/callback/${env.MPESA_CALLBACK_TOKEN}/${kind}`;
}
