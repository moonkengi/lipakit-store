#!/usr/bin/env node
/**
 * SELLER ONLY (not shipped to buyers). Generates the Ed25519 key pair for
 * signing LipaKit licence keys.
 *   - The private key goes to ~/.lipakit/license-private.pem (keep it there,
 *     back it up somewhere safe, never commit it).
 *   - Paste the printed public key into src/config/license.ts.
 */
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".lipakit");
const file = join(dir, "license-private.pem");
if (existsSync(file) && !process.argv.includes("--force")) {
  console.error(
    `${file} already exists. Re-running would invalidate every key you've issued. Use --force only if you mean it.`,
  );
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
mkdirSync(dir, { recursive: true, mode: 0o700 });
writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
console.log(`Private key written to ${file}\n\nPublic key for src/config/license.ts:\n`);
console.log(publicKey.export({ type: "spki", format: "pem" }));
