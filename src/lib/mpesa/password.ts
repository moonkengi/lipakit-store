/**
 * Daraja timestamps and the Lipa Na M-Pesa Online password.
 */

/** Kenya (EAT) is UTC+3 all year; there is no daylight saving. */
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Timestamp in Daraja's format, YYYYMMDDHHmmss, in Kenya time.
 * Uses fixed-offset arithmetic so it doesn't depend on the server's time zone
 * (Vercel runs in UTC).
 */
export function darajaTimestamp(date: Date = new Date()): string {
  const eat = new Date(date.getTime() + EAT_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    eat.getUTCFullYear().toString() +
    pad(eat.getUTCMonth() + 1) +
    pad(eat.getUTCDate()) +
    pad(eat.getUTCHours()) +
    pad(eat.getUTCMinutes()) +
    pad(eat.getUTCSeconds())
  );
}

/** STK password = base64(shortcode + passkey + timestamp). The same timestamp must be sent in the request. */
export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`, "utf8").toString("base64");
}
