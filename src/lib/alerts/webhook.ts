/**
 * Generic webhook: every event POSTed as JSON to a URL you choose, signed so
 * the receiver can prove it came from your app.
 *
 * Header: `X-LipaKit-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`
 * Receivers should check the signature and reject old timestamps (replays).
 * `verifyWebhookSignature()` below does both; copy it into the receiving app.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AlertChannel, AlertEvent } from "./types";

export const SIGNATURE_HEADER = "X-LipaKit-Signature";

export function signPayload(secret: string, body: string, timestamp: number): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

export function verifyWebhookSignature(opts: {
  secret: string;
  body: string;
  header: string | null;
  /** Reject signatures older than this. Default 5 minutes. */
  toleranceSeconds?: number;
  now?: number;
}): boolean {
  const parts = Object.fromEntries((opts.header ?? "").split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(now - t) > (opts.toleranceSeconds ?? 300)) return false;
  const expected = signPayload(opts.secret, opts.body, t).split("v1=")[1];
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function webhookChannel(url: string, secret: string, fetchImpl: typeof fetch = fetch): AlertChannel {
  return {
    name: "webhook",
    async send(event: AlertEvent) {
      const body = JSON.stringify({
        id: randomUUID(),
        type: event.type,
        created_at: new Date().toISOString(),
        title: event.title,
        message: event.message,
        link: event.link ?? null,
        data: event.data ?? {},
      });
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [SIGNATURE_HEADER]: signPayload(secret, body, Math.floor(Date.now() / 1000)),
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok
          ? { channel: "webhook", ok: true }
          : { channel: "webhook", ok: false, error: `HTTP ${res.status}` };
      } catch (error) {
        return { channel: "webhook", ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
