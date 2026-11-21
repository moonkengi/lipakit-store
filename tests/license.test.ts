import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLicenseKey } from "@/lib/license";
import { checkLicense } from "@/lib/health";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const other = generateKeyPairSync("ed25519");

function makeKey(payload: object, key = privateKey) {
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${p}.${sign(null, Buffer.from(p), key).toString("base64url")}`;
}
const good = {
  id: "LK-ABC123",
  tier: "solo",
  licensee: "Test Buyer",
  issuedAt: "2026-11-01",
  updatesUntil: "2027-11-01",
};

describe("verifyLicenseKey", () => {
  it("accepts a key signed with the matching private key", () => {
    const r = verifyLicenseKey(makeKey(good), PEM);
    expect(r).toEqual({ valid: true, license: good });
  });
  it("rejects a key signed by someone else", () => {
    expect(verifyLicenseKey(makeKey(good, other.privateKey), PEM).valid).toBe(false);
  });
  it("rejects a tampered payload", () => {
    const [, sig] = makeKey(good).split(".");
    const forged = Buffer.from(JSON.stringify({ ...good, tier: "agency" })).toString("base64url");
    expect(verifyLicenseKey(`${forged}.${sig}`, PEM).valid).toBe(false);
  });
  it("rejects garbage and missing fields", () => {
    expect(verifyLicenseKey("nope", PEM).valid).toBe(false);
    expect(verifyLicenseKey("a.b.c", PEM).valid).toBe(false);
    expect(verifyLicenseKey(makeKey({ ...good, tier: "gold" }), PEM).valid).toBe(false);
  });
  it("reports a malformed public key instead of throwing", () => {
    expect(verifyLicenseKey(makeKey(good), "REPLACE_WITH_YOUR_PUBLIC_KEY").valid).toBe(false);
  });
});

describe("checkLicense", () => {
  const now = new Date("2027-01-01T00:00:00Z");
  it("is info when no key is set", () => expect(checkLicense(undefined, PEM, now).status).toBe("info"));
  it("is ok while updates are covered", () => expect(checkLicense(makeKey(good), PEM, now).status).toBe("ok"));
  it("is info once the update window has ended", () => {
    const c = checkLicense(makeKey(good), PEM, new Date("2028-01-01T00:00:00Z"));
    expect(c.status).toBe("info");
    expect(c.detail).toContain("ended");
  });
  it("warns on an invalid key", () => expect(checkLicense("x.y", PEM, now).status).toBe("warn"));
});
