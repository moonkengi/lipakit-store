/**
 * The one place that talks HTTP to Daraja: timeouts, JSON parsing, Zod
 * validation and error mapping all happen here, so every endpoint behaves the same.
 */
import type { z } from "zod";
import { MpesaError } from "./errors";
import { darajaErrorSchema } from "./schemas";
import type { MpesaMode } from "./types";

export const DARAJA_BASE_URLS: Record<Exclude<MpesaMode, "simulator">, string> = {
  sandbox: "https://sandbox.safaricom.co.ke",
  production: "https://api.safaricom.co.ke",
};

export type DarajaRequest<T extends z.ZodType> = {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  schema: T;
  timeoutMs: number;
  fetch: typeof fetch;
};

/** The parsed JSON body, or a Daraja error body if the request failed (so callers can inspect errorCode). */
export async function darajaRequest<T extends z.ZodType>(req: DarajaRequest<T>): Promise<z.infer<T>> {
  let res: Response;
  try {
    res = await req.fetch(req.url, {
      method: req.method,
      headers: {
        Accept: "application/json",
        ...(req.body ? { "Content-Type": "application/json" } : {}),
        ...req.headers,
      },
      body: req.body ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(req.timeoutMs),
    });
  } catch (cause) {
    if (cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
      throw new MpesaError("timeout", "M-Pesa took too long to respond. Please try again.", { cause });
    }
    throw new MpesaError("network", "We couldn't reach M-Pesa. Please try again.", { cause });
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch (cause) {
    throw new MpesaError("invalid_response", "M-Pesa sent a response we couldn't read.", {
      httpStatus: res.status,
      cause,
    });
  }

  if (!res.ok) {
    const parsed = darajaErrorSchema.safeParse(json);
    const daraja = parsed.success ? parsed.data : undefined;
    const code = res.status === 401 ? "auth" : "rejected";
    throw new MpesaError(code, readableDarajaError(daraja?.errorMessage, res.status), {
      httpStatus: res.status,
      daraja,
    });
  }

  const parsed = req.schema.safeParse(json);
  if (!parsed.success) {
    throw new MpesaError("invalid_response", "M-Pesa sent a response we didn't expect.", {
      httpStatus: res.status,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** Daraja's messages are written for developers; keep them out of the customer UI. */
function readableDarajaError(errorMessage: string | undefined, status: number): string {
  if (status === 401) return "M-Pesa rejected our credentials. (Check MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET.)";
  if (status >= 500) return "M-Pesa is having trouble right now. Please try again in a moment.";
  return errorMessage ? `M-Pesa rejected the request: ${errorMessage}` : "M-Pesa rejected the request.";
}
