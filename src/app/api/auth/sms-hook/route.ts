/**
 * Supabase Auth "Send SMS" hook → Africa's Talking.
 * Set it up in Supabase → Authentication → Hooks → Send SMS hook (HTTPS):
 *   URL: https://<your-app>/api/auth/sms-hook   Secret: copy into SUPABASE_SMS_HOOK_SECRET
 * See docs/01-setup.md → "Phone sign-in".
 */
import { NextResponse } from "next/server";
import { siteConfig } from "@/config/site";
import { verifyStandardWebhook, smsHookPayloadSchema } from "@/lib/auth-sms-hook";
import { getServerEnv } from "@/lib/env";
import { getNotifier } from "@/lib/notify";

const fail = (status: number, message: string) =>
  NextResponse.json({ error: { http_code: status, message } }, { status });

export async function POST(request: Request) {
  const env = getServerEnv();
  if (!env.SUPABASE_SMS_HOOK_SECRET) return fail(404, "SMS hook not configured");

  const body = await request.text();
  const ok = verifyStandardWebhook({
    secret: env.SUPABASE_SMS_HOOK_SECRET,
    id: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
    body,
  });
  if (!ok) return fail(401, "Invalid signature");

  const parsed = smsHookPayloadSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return fail(400, "Unexpected payload");

  const sms = getNotifier().sms;
  if (!sms) return fail(500, "SMS isn't configured (AT_USERNAME, AT_API_KEY)");

  const phone = parsed.data.user.phone.replace(/^\+/, "");
  const result = await sms.send(
    phone,
    `Your ${siteConfig.name} sign-in code is ${parsed.data.sms.otp}. It expires soon; don't share it.`,
  );
  if (!result.ok) {
    console.error("[auth] OTP SMS failed:", result.error);
    return fail(502, "Couldn't send the SMS. Please try again.");
  }
  return NextResponse.json({});
}
