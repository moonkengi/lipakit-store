/**
 * Telegram account linking with a one-time code.
 *
 *   1. The signed-in user clicks "Link Telegram": we store sha256(code) with a
 *      15-minute expiry and show a t.me deep link containing the code.
 *   2. Telegram opens the bot and sends "/start <code>" to our webhook.
 *   3. We look the hash up, mark it used, and save the chat ID on the profile.
 * The code is single-use and never stored in plain text.
 */
import { createHash, randomInt } from "node:crypto";

export const LINK_CODE_TTL_MS = 15 * 60 * 1000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateLinkCode(length = 10): string {
  let code = "";
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export function hashLinkCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

/** "/start CODE" or "/start@MyBot CODE" → "CODE". Anything else → null. */
export function parseStartCommand(text: string | undefined): string | null {
  const m = /^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,32})\s*$/.exec(text?.trim() ?? "");
  return m ? m[1].toUpperCase() : null;
}

export function telegramDeepLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername.replace(/^@/, "")}?start=${code}`;
}
