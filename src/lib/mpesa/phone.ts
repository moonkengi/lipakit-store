import { MpesaError } from "./errors";

/**
 * Normalise a Kenyan mobile number to the format Daraja expects: 2547XXXXXXXX
 * or 2541XXXXXXXX (12 digits, no plus sign).
 *
 * Accepts the formats people actually type:
 *   0712 345 678 · 0112345678 · 712345678 · +254 712 345 678 · 254712345678 · (0712) 345-678
 *
 * Throws MpesaError("invalid_input") with a message you can show the user.
 */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[\s\-().]/g, "").replace(/^\+/, "");

  if (!/^\d+$/.test(digits)) {
    throw new MpesaError("invalid_input", "Enter a phone number using digits only, e.g. 0712 345 678.");
  }

  let local: string; // the 9 digits after the country code
  if (digits.startsWith("254") && digits.length === 12) local = digits.slice(3);
  else if (digits.startsWith("0") && digits.length === 10) local = digits.slice(1);
  else if (digits.length === 9) local = digits;
  else throw new MpesaError("invalid_input", "That doesn't look like a Kenyan phone number. Try 0712 345 678.");

  // Kenyan mobile numbers start with 7 or 1 after the country code.
  if (!/^[17]\d{8}$/.test(local)) {
    throw new MpesaError("invalid_input", "Use a Kenyan mobile number starting with 07 or 01.");
  }
  return `254${local}`;
}

/** Display form, e.g. 254712345678 → 0712 345 678. */
export function formatPhone(normalized: string): string {
  const local = `0${normalized.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/** Masked display form for logs and admin lists, e.g. 0712 ••• 678. */
export function maskPhone(normalized: string): string {
  const f = formatPhone(normalized);
  return `${f.slice(0, 4)} ••• ${f.slice(9)}`;
}
