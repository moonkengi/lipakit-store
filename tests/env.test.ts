import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";

const base = {
  NEXT_PUBLIC_SITE_URL: "https://app.example.co.ke/",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  MPESA_CALLBACK_TOKEN: "x".repeat(24),
  CRON_SECRET: "y".repeat(16),
};

describe("parseServerEnv", () => {
  it("accepts a minimal simulator config and applies defaults", () => {
    const env = parseServerEnv(base);
    expect(env.MPESA_MODE).toBe("simulator");
    expect(env.MPESA_TILL_OR_PAYBILL).toBe("paybill");
    expect(env.GRACE_DAYS).toBe(3);
    expect(env.TELEGRAM_ADMIN_CHAT_IDS).toEqual([]);
  });

  it("strips the trailing slash from the site URL", () => {
    expect(parseServerEnv(base).NEXT_PUBLIC_SITE_URL).toBe("https://app.example.co.ke");
  });

  it("treats empty strings as unset", () => {
    const env = parseServerEnv({ ...base, AT_USERNAME: "", AT_API_KEY: "" });
    expect(env.AT_USERNAME).toBeUndefined();
  });

  it("requires Daraja credentials outside simulator mode", () => {
    expect(() => parseServerEnv({ ...base, MPESA_MODE: "sandbox" })).toThrow(/MPESA_CONSUMER_KEY is required/);
    expect(() =>
      parseServerEnv({
        ...base,
        MPESA_MODE: "production",
        MPESA_CONSUMER_KEY: "k",
        MPESA_CONSUMER_SECRET: "s",
        MPESA_SHORTCODE: "600000",
        MPESA_PASSKEY: "p",
      }),
    ).not.toThrow();
  });

  it("rejects a short callback token", () => {
    expect(() => parseServerEnv({ ...base, MPESA_CALLBACK_TOKEN: "short" })).toThrow(/at least 24/);
  });

  it("requires paired provider settings together", () => {
    expect(() => parseServerEnv({ ...base, RESEND_API_KEY: "re_123" })).toThrow(/RESEND_API_KEY and EMAIL_FROM/);
  });

  it("parses admin chat IDs and GRACE_DAYS", () => {
    const env = parseServerEnv({ ...base, TELEGRAM_ADMIN_CHAT_IDS: " 123, -100456 ,", GRACE_DAYS: "5" });
    expect(env.TELEGRAM_ADMIN_CHAT_IDS).toEqual(["123", "-100456"]);
    expect(env.GRACE_DAYS).toBe(5);
  });

  it("rejects an unknown MPESA_MODE", () => {
    expect(() => parseServerEnv({ ...base, MPESA_MODE: "live" })).toThrow(/MPESA_MODE/);
  });
});
