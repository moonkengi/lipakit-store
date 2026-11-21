/**
 * Public key used to check LIPAKIT_LICENSE_KEY (see src/lib/license.ts).
 * Safe to publish: it can only verify keys, not create them.
 * Seller: replace with the output of `node scripts/release/keys.mjs`.
 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
REPLACE_WITH_YOUR_PUBLIC_KEY
-----END PUBLIC KEY-----`;
