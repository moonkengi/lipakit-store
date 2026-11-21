import { describe, expect, it, vi } from "vitest";
import { featureAllows, featureLimit, isLive } from "@/lib/billing/entitlements";
import { parseServerEnv } from "@/lib/env";
import { createResendEmail } from "@/lib/notify/email";
import { renewalReminder } from "@/lib/notify/messages";
import { createAfricasTalkingSms } from "@/lib/notify/sms";
import { createTelegram } from "@/lib/notify/telegram";
import { isReceiptNumber, parseReceiptNumber } from "@/lib/receipts/numbering";
import { buildReceiptPdf } from "@/lib/receipts/pdf";

const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

describe("Africa's Talking SMS", () => {
  it("sends a form-encoded request with the API key header", async () => {
    const fetch = ok({ SMSMessageData: { Recipients: [{ status: "Success", messageId: "ATX1" }] } });
    const res = await createAfricasTalkingSms({ username: "myapp", apiKey: "key", senderId: "LIPAKIT", fetch }).send(
      "254712345678",
      "Hi",
    );
    expect(res).toEqual({ ok: true, id: "ATX1" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.africastalking.com/version1/messaging");
    expect((init.headers as Record<string, string>).apiKey).toBe("key");
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toEqual({
      username: "myapp",
      to: "+254712345678",
      message: "Hi",
      from: "LIPAKIT",
    });
  });

  it("uses the sandbox host for the sandbox username", async () => {
    const fetch = ok({ SMSMessageData: { Recipients: [{ status: "Success" }] } });
    await createAfricasTalkingSms({ username: "sandbox", apiKey: "k", fetch }).send("254712345678", "Hi");
    expect(String((fetch.mock.calls[0] as unknown as [string])[0])).toContain("api.sandbox.africastalking.com");
  });

  it("reports a per-recipient failure", async () => {
    const fetch = ok({ SMSMessageData: { Recipients: [{ status: "InsufficientBalance" }] } });
    expect(await createAfricasTalkingSms({ username: "u", apiKey: "k", fetch }).send("254712345678", "Hi")).toEqual({
      ok: false,
      error: "InsufficientBalance",
    });
  });
});

describe("Resend email", () => {
  it("sends attachments as base64", async () => {
    const fetch = ok({ id: "em_1" });
    await createResendEmail({ apiKey: "re_x", from: "LipaKit <b@x.co.ke>", fetch }).send({
      to: "a@x.co.ke",
      subject: "Receipt",
      text: "Thanks",
      attachments: [{ filename: "r.pdf", content: new Uint8Array([37, 80, 68, 70]) }],
    });
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({
      from: "LipaKit <b@x.co.ke>",
      to: ["a@x.co.ke"],
      attachments: [{ filename: "r.pdf", content: "JVBERg==" }],
    });
  });
});

describe("Telegram", () => {
  it("returns the Bot API's error description on failure", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "chat not found" })));
    expect(await createTelegram({ botToken: "t", fetch }).send(1, "x")).toEqual({ ok: false, error: "chat not found" });
  });
});

describe("messages", () => {
  it("keeps the renewal reminder SMS within one segment for a typical plan", () => {
    const m = renewalReminder({
      product: "LipaKit",
      planName: "Pro",
      amountKes: 1500,
      dueDate: new Date("2026-12-21T09:00:00Z"),
      pay: { link: "https://app.co.ke/dashboard/billing" },
    });
    expect(m.sms.length).toBeLessThanOrEqual(160);
    expect(m.sms).toContain("KES 1,500");
  });
});

describe("receipts", () => {
  it("builds a valid PDF, including characters the standard font can't draw", async () => {
    const pdf = await buildReceiptPdf({
      businessName: "LipaKit",
      supportEmail: "support@example.com",
      receiptNumber: "LK-2026-000123",
      issuedAt: new Date("2026-11-21T09:00:00Z"),
      customerName: "Wanjiku Kamau",
      customerEmail: "w@example.com",
      description: "Pro (subscription)",
      period: "21 Nov 2026 to 21 Dec 2026",
      amountKes: 1500,
      mpesaReceipt: "NLJ7RT61SV",
      phoneMasked: "0712 ••• 678",
      accountRef: "LKAB12CD34",
    });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("recognises receipt numbers", () => {
    expect(isReceiptNumber("lk-2026-000123")).toBe(true);
    expect(parseReceiptNumber("LK-2026-000123")).toEqual({ prefix: "LK", year: 2026, sequence: 123 });
    expect(isReceiptNumber("LK2026000123")).toBe(false);
  });
});

describe("entitlements", () => {
  it("knows which statuses have access", () => {
    expect(["trialing", "active", "grace"].every((s) => isLive(s as never))).toBe(true);
    expect(isLive("expired")).toBe(false);
    expect(isLive(null)).toBe(false);
  });

  it("reads feature flags and limits from plan features", () => {
    const f = { reports: true, max_projects: 10, beta: false, seats: 0, tier: "pro" };
    expect(featureAllows(f, "reports")).toBe(true);
    expect(featureAllows(f, "max_projects")).toBe(true);
    expect(featureAllows(f, "beta")).toBe(false);
    expect(featureAllows(f, "seats")).toBe(false);
    expect(featureAllows(f, "tier")).toBe(true);
    expect(featureAllows(f, "missing")).toBe(false);
    expect(featureAllows(null, "reports")).toBe(false);
    expect(featureLimit(f, "max_projects")).toBe(10);
    expect(featureLimit(f, "reports")).toBeNull();
  });
});

describe("env: callback token", () => {
  const base = {
    NEXT_PUBLIC_SITE_URL: "https://app.example.co.ke",
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    CRON_SECRET: "y".repeat(16),
  };
  it("rejects tokens containing words Safaricom blocks, or URL-unsafe characters", () => {
    expect(() => parseServerEnv({ ...base, MPESA_CALLBACK_TOKEN: "abcqueryabcdefghijklmnopqrst" })).toThrow(/blocks/);
    expect(() => parseServerEnv({ ...base, MPESA_CALLBACK_TOKEN: "abc/def+ghijklmnopqrstuvwxyz" })).toThrow(
      /letters, digits/,
    );
    expect(() => parseServerEnv({ ...base, MPESA_CALLBACK_TOKEN: "3f9a0c1b2d4e5f60718293a4b5c6d7e8" })).not.toThrow();
  });
  it("parses the Ratiba flag", () => {
    const env = parseServerEnv({ ...base, MPESA_CALLBACK_TOKEN: "x".repeat(24), MPESA_RATIBA_ENABLED: "true" });
    expect(env.MPESA_RATIBA_ENABLED).toBe(true);
    expect(env.MPESA_C2B_VALIDATION).toBe("accept");
  });
});
