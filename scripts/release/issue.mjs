#!/usr/bin/env node
/**
 * SELLER ONLY (not shipped to buyers). Issues a licence and builds that
 * buyer's copy of the kit.
 *
 *   node scripts/release/issue.mjs --email buyer@example.com --name "Jane Doe" --tier solo [--github janedoe]
 *
 * What it does:
 *   1. Creates a licence ID and signs a licence key (private key from ~/.lipakit).
 *   2. Exports the committed code with `git archive` (files marked export-ignore in
 *      .gitattributes, like this script and the business docs, are left out).
 *   3. Stamps the buyer's details into LICENSE.md, adds .lipakit-license, and
 *      embeds the licence ID in a few files so a leaked copy can be traced.
 *   4. Zips it to dist/lipakit-<ID>.zip and records the sale in ~/.lipakit/licences.csv.
 *   5. With --github, invites the buyer (read-only) to LIPAKIT_DELIVERY_REPO
 *      (e.g. moonkengi/lipakit-releases) using the GitHub CLI.
 */
import { execFileSync } from "node:child_process";
import { createPrivateKey, randomInt, sign } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (acc, a, i, all) =>
        a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") ? true : (all[i + 1] ?? true)]] : acc,
      [],
    ),
);
const TIERS = { lite: 6, solo: 12, agency: 12 }; // months of updates
const tier = String(args.tier ?? "");
if (!args.email || !(tier in TIERS)) {
  console.error(
    'Usage: issue.mjs --email buyer@example.com --name "Jane Doe" --tier lite|solo|agency [--github user] [--months 12] [--allow-draft]',
  );
  process.exit(1);
}

const root = resolve(process.cwd());
const licenceText = readFileSync(join(root, "LICENSE.md"), "utf8");
if ((/DRAFT/.test(licenceText) || licenceText.includes("{{REFUND_POLICY}}")) && !args["allow-draft"]) {
  console.error(
    "LICENSE.md is still a draft (DRAFT notice or {{REFUND_POLICY}} placeholder). Finalise it first, or pass --allow-draft for test copies.",
  );
  process.exit(1);
}

const keyFile = join(homedir(), ".lipakit", "license-private.pem");
if (!existsSync(keyFile)) {
  console.error(`No signing key at ${keyFile}. Run node scripts/release/keys.mjs first.`);
  process.exit(1);
}

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const id = `LK-${Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("")}`;
const months = Number(args.months ?? TIERS[tier]);
const issuedAt = new Date();
const updatesUntil = new Date(issuedAt);
updatesUntil.setMonth(updatesUntil.getMonth() + months);
const licensee = args.name ? `${args.name} <${args.email}>` : String(args.email);

const payload = Buffer.from(
  JSON.stringify({
    id,
    tier,
    licensee,
    issuedAt: issuedAt.toISOString(),
    updatesUntil: updatesUntil.toISOString().slice(0, 10),
  }),
).toString("base64url");
const signature = sign(null, Buffer.from(payload), createPrivateKey(readFileSync(keyFile))).toString("base64url");
const licenseKey = `${payload}.${signature}`;

// Export the committed tree (uncommitted changes are deliberately not shipped).
const work = mkdtempSync(join(tmpdir(), "lipakit-"));
const out = join(work, "lipakit");
mkdirSync(out);
execFileSync("sh", ["-c", `git archive --format=tar HEAD | tar -x -C "${out}"`], { cwd: root, stdio: "inherit" });

const stamp = (rel, fn) => {
  const f = join(out, rel);
  if (existsSync(f)) writeFileSync(f, fn(readFileSync(f, "utf8")));
};
stamp("LICENSE.md", (t) =>
  t
    .replaceAll("{{LICENSE_ID}}", id)
    .replaceAll("{{LICENSEE}}", licensee)
    .replaceAll("{{TIER}}", tier[0].toUpperCase() + tier.slice(1))
    .replaceAll("{{UPDATES_UNTIL}}", updatesUntil.toISOString().slice(0, 10)),
);
stamp("package.json", (t) => {
  const pkg = JSON.parse(t);
  pkg.lipakit = { licenseId: id };
  return `${JSON.stringify(pkg, null, 2)}\n`;
});
// Harmless trace markers: a leaked copy still carries the ID even if LICENSE.md is deleted.
for (const rel of ["src/config/site.ts", "src/lib/env.ts", "src/app/globals.css"]) {
  stamp(rel, (t) =>
    rel.endsWith(".css") ? `/* build ${id.toLowerCase()} */\n${t}` : `// build ${id.toLowerCase()}\n${t}`,
  );
}
writeFileSync(join(out, ".lipakit-license"), `${licenseKey}\n`);
stamp(
  ".env.example",
  (t) =>
    `${t}\n# Your licence (shown on the admin Health page; the app works without it).\nLIPAKIT_LICENSE_KEY=${licenseKey}\n`,
);

mkdirSync(join(root, "dist"), { recursive: true });
const zip = join(root, "dist", `lipakit-${id}.zip`);
execFileSync("sh", ["-c", `cd "${work}" && zip -qr "${zip}" lipakit`]);
rmSync(work, { recursive: true, force: true });

const ledger = join(homedir(), ".lipakit", "licences.csv");
if (!existsSync(ledger)) appendFileSync(ledger, "issued_at,licence_id,tier,email,name,updates_until,github\n");
appendFileSync(
  ledger,
  [
    issuedAt.toISOString(),
    id,
    tier,
    args.email,
    JSON.stringify(args.name ?? ""),
    updatesUntil.toISOString().slice(0, 10),
    args.github ?? "",
  ].join(",") + "\n",
);

if (args.github) {
  const repo = process.env.LIPAKIT_DELIVERY_REPO;
  if (!repo) console.warn("LIPAKIT_DELIVERY_REPO isn't set; skipping the GitHub invite.");
  else {
    execFileSync("gh", ["api", "-X", "PUT", `repos/${repo}/collaborators/${args.github}`, "-f", "permission=pull"], {
      stdio: "inherit",
    });
    console.log(`Invited ${args.github} to ${repo} (read-only).`);
  }
}

console.log(
  `\nLicence ${id} (${tier}, updates until ${updatesUntil.toISOString().slice(0, 10)})\nPackage: ${zip}\nLedger:  ${ledger}`,
);
