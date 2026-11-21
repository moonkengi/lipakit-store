/**
 * Supabase Auth "Send SMS" hook: Supabase generates the phone OTP and POSTs it
 * here; we deliver it with Africa's Talking (Supabase has no built-in AT provider).
 *
 * Requests are signed with the Standard Webhooks scheme: headers webhook-id,
 * webhook-timestamp and webhook-signature ("v1,<base64 HMAC-SHA256 of
 * 'id.timestamp.body'>"), keyed with the secret Supabase shows as
 * "v1,whsec_<base64>". Confirm the payload shape against Supabase's current
 * Auth Hooks docs if it ever changes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function verifyStandardWebhook(opts: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  toleranceSeconds?: number;
  now?: number;
}): boolean {
  if (!opts.id || !opts.timestamp || !opts.signature) return false;
  const ts = Number(opts.timestamp);
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (opts.toleranceSeconds ?? 300)) return false;

  const key = Buffer.from(opts.secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${opts.id}.${opts.timestamp}.${opts.body}`).digest();
  // The header may hold several space-separated signatures ("v1,abc v1,def") during secret rotation.
  return opts.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export const smsHookPayloadSchema = z.object({
  user: z.object({ phone: z.string().min(9) }),
  sms: z.object({ otp: z.string().min(4).max(10) }),
});
