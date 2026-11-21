#!/usr/bin/env node
/**
 * SELLER ONLY. Found a leaked copy? Point this at the folder or a file from it:
 *   node scripts/release/trace.mjs ./leaked-copy
 * It looks for the licence ID markers and matches them against ~/.lipakit/licences.csv.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("Usage: trace.mjs <folder-or-file>");
  process.exit(1);
}
let text = "";
try {
  text = execFileSync("grep", ["-rhoiE", "(build lk-[a-z0-9]{6}|LK-[A-Z0-9]{6})", target], { encoding: "utf8" });
} catch {
  // grep exits 1 when nothing matches
}
const ids = [...new Set(text.match(/lk-[a-z0-9]{6}/gi)?.map((m) => m.toUpperCase()) ?? [])];
if (!ids.length) {
  console.log("No licence markers found.");
  process.exit(0);
}
const ledger = join(homedir(), ".lipakit", "licences.csv");
const rows = existsSync(ledger) ? readFileSync(ledger, "utf8").split("\n") : [];
for (const id of ids) {
  const row = rows.find((r) => r.split(",")[1] === id);
  console.log(row ? `${id}: ${row}` : `${id}: not in your ledger`);
}
