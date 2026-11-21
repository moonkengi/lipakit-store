import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { smsHookPayloadSchema, verifyStandardWebhook } from "@/lib/auth-sms-hook";

const rawKey = Buffer.from("test-secret-key-material-32bytes!");
const secret = `v1,whsec_${rawKey.toString("base64")}`;
const now = 1_790_000_000_000;
const ts = String(Math.floor(now / 1000));
const body = JSON.stringify({ user: { phone: "254712345678" }, sms: { otp: "123456" } });
const sig = (b = body, t = ts, key = rawKey) =>
  `v1,${createHmac("sha256", key).update(`msg_1.${t}.${b}`).digest("base64")}`;

describe("verifyStandardWebhook", () => {
  const base = { secret, id: "msg_1", timestamp: ts, body, now };
  it("accepts a correct signature", () => expect(verifyStandardWebhook({ ...base, signature: sig() })).toBe(true));
  it("accepts when one of several rotated signatures matches", () =>
    expect(verifyStandardWebhook({ ...base, signature: `v1,AAAA ${sig()}` })).toBe(true));
  it("rejects a changed body", () =>
    expect(verifyStandardWebhook({ ...base, body: body + " ", signature: sig() })).toBe(false));
  it("rejects the wrong secret", () =>
    expect(verifyStandardWebhook({ ...base, signature: sig(body, ts, Buffer.from("other")) })).toBe(false));
  it("rejects old timestamps (replay)", () =>
    expect(verifyStandardWebhook({ ...base, now: now + 10 * 60_000, signature: sig() })).toBe(false));
  it("rejects missing headers", () =>
    expect(verifyStandardWebhook({ ...base, id: null, signature: sig() })).toBe(false));
});

describe("smsHookPayloadSchema", () => {
  it("parses the hook payload", () => expect(smsHookPayloadSchema.safeParse(JSON.parse(body)).success).toBe(true));
  it("rejects a payload without an OTP", () =>
    expect(smsHookPayloadSchema.safeParse({ user: { phone: "254712345678" } }).success).toBe(false));
});
