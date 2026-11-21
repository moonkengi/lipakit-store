/**
 * Daraja OAuth: client-credentials token, cached in memory until shortly
 * before it expires. Concurrent callers share one in-flight request.
 */
import { darajaRequest } from "./http";
import { oauthResponseSchema } from "./schemas";

/** Refresh this long before Daraja's stated expiry, to allow for clock skew and slow requests. */
const EXPIRY_MARGIN_MS = 60_000;

export type TokenProvider = { getToken(): Promise<string>; clear(): void };

export function createTokenProvider(opts: {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  timeoutMs: number;
  fetch: typeof fetch;
  now: () => Date;
}): TokenProvider {
  let cached: { token: string; expiresAt: number } | undefined;
  let inFlight: Promise<string> | undefined;

  async function fetchToken(): Promise<string> {
    const basic = Buffer.from(`${opts.consumerKey}:${opts.consumerSecret}`).toString("base64");
    const data = await darajaRequest({
      url: `${opts.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      method: "GET",
      headers: { Authorization: `Basic ${basic}` },
      schema: oauthResponseSchema,
      timeoutMs: opts.timeoutMs,
      fetch: opts.fetch,
    });
    cached = { token: data.access_token, expiresAt: opts.now().getTime() + data.expires_in * 1000 - EXPIRY_MARGIN_MS };
    return data.access_token;
  }

  return {
    async getToken() {
      if (cached && cached.expiresAt > opts.now().getTime()) return cached.token;
      inFlight ??= fetchToken().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
    clear() {
      cached = undefined;
    },
  };
}
