/**
 * Sanitise a user-supplied "?next=" path so sign-in can't be abused as an
 * open redirect (e.g. ?next=https://evil.example or ?next=//evil.example).
 * Only same-site absolute paths are allowed; anything else falls back.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // Reject control characters, which some browsers strip before resolving.
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}
