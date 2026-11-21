/**
 * LipaKit licence keys: what tier this copy is licensed for and until when it
 * gets updates. Keys are signed offline by the seller (Ed25519) and checked
 * here with the public key, so there's no licence server and nothing phones home.
 *
 * The app never stops working because of a licence: the key is only shown on
 * the Health page, so you know which updates you're entitled to.
 *
 * Format: base64url(JSON payload) + "." + base64url(Ed25519 signature of the payload part)
 */
import { createPublicKey, verify } from "node:crypto";

export type LicenseTier = "lite" | "solo" | "agency";

export type License = {
  /** e.g. LK-7K2M9Q */
  id: string;
  tier: LicenseTier;
  licensee: string;
  issuedAt: string;
  /** ISO date; updates released after this aren't covered. */
  updatesUntil: string;
};

export type LicenseCheck = { valid: true; license: License } | { valid: false; reason: string };

const TIERS: LicenseTier[] = ["lite", "solo", "agency"];

export function verifyLicenseKey(key: string, publicKeyPem: string): LicenseCheck {
  const [payloadPart, sigPart, extra] = key.trim().split(".");
  if (!payloadPart || !sigPart || extra !== undefined) return { valid: false, reason: "Not a LipaKit licence key." };
  let ok = false;
  try {
    ok = verify(null, Buffer.from(payloadPart), createPublicKey(publicKeyPem), Buffer.from(sigPart, "base64url"));
  } catch {
    return { valid: false, reason: "The licence public key or the key itself is malformed." };
  }
  if (!ok) return { valid: false, reason: "Signature doesn't match: this key wasn't issued for LipaKit." };

  try {
    const p = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Partial<License>;
    if (!p.id || !p.licensee || !p.issuedAt || !p.updatesUntil || !TIERS.includes(p.tier as LicenseTier)) {
      return { valid: false, reason: "The licence key is missing fields." };
    }
    return { valid: true, license: p as License };
  } catch {
    return { valid: false, reason: "The licence key payload is unreadable." };
  }
}
