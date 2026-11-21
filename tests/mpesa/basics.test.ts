import { describe, expect, it } from "vitest";
import { darajaTimestamp, describeResultCode, formatPhone, maskPhone, normalizePhone, stkPassword } from "@/lib/mpesa";
import { MpesaError } from "@/lib/mpesa/errors";

describe("normalizePhone", () => {
  it.each([
    ["0712345678", "254712345678"],
    ["0712 345 678", "254712345678"],
    ["712345678", "254712345678"],
    ["+254712345678", "254712345678"],
    ["+254 712 345 678", "254712345678"],
    ["254712345678", "254712345678"],
    ["(0712) 345-678", "254712345678"],
    ["0112345678", "254112345678"],
    ["0110 123 456", "254110123456"],
  ])("normalises %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    "",
    "07123",
    "07123456789", // too long
    "0212345678", // landline prefix
    "255712345678", // Tanzania
    "0712abc678",
    "+1 415 555 0100",
  ])("rejects %s with a readable invalid_input error", (input) => {
    try {
      normalizePhone(input);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MpesaError);
      expect((error as MpesaError).code).toBe("invalid_input");
      expect((error as MpesaError).message.length).toBeGreaterThan(10);
    }
  });

  it("formats and masks for display", () => {
    expect(formatPhone("254712345678")).toBe("0712 345 678");
    expect(maskPhone("254712345678")).toBe("0712 ••• 678");
  });
});

describe("darajaTimestamp", () => {
  it("uses Kenya time (UTC+3) regardless of server time zone", () => {
    expect(darajaTimestamp(new Date("2026-11-21T09:05:07Z"))).toBe("20261121120507");
  });

  it("rolls over the date at midnight EAT", () => {
    // 22:30 UTC on 31 Dec is 01:30 on 1 Jan in Nairobi.
    expect(darajaTimestamp(new Date("2026-12-31T22:30:00Z"))).toBe("20270101013000");
  });
});

describe("stkPassword", () => {
  it("is base64(shortcode + passkey + timestamp)", () => {
    const pw = stkPassword("174379", "passkey123", "20261121120507");
    expect(Buffer.from(pw, "base64").toString()).toBe("174379passkey12320261121120507");
  });

  it("matches a known value", () => {
    expect(stkPassword("174379", "abc", "20240101000000")).toBe("MTc0Mzc5YWJjMjAyNDAxMDEwMDAwMDA=");
  });
});

describe("describeResultCode", () => {
  it.each([
    [0, "success", "paid"],
    [1, "failed", "failed"],
    [1032, "cancelled", "cancelled"],
    [1037, "timeout", "expired"],
    [1019, "timeout", "expired"],
    [2001, "failed", "failed"],
    [1001, "failed", "failed"],
  ] as const)("maps %i to tx=%s order=%s", (code, tx, order) => {
    const info = describeResultCode(code);
    expect(info.txStatus).toBe(tx);
    expect(info.orderStatus).toBe(order);
  });

  it("gives every code a customer-friendly message", () => {
    expect(describeResultCode(1).message).toMatch(/balance/i);
    expect(describeResultCode(1032).message).toMatch(/cancelled/i);
    expect(describeResultCode(2001).message).toMatch(/PIN/);
  });

  it("treats unknown codes as a failure and names the code", () => {
    const info = describeResultCode(4242);
    expect(info.txStatus).toBe("failed");
    expect(info.message).toContain("4242");
  });
});
