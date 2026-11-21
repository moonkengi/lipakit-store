import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBundle } from "../scripts/bundle-sql.mjs";

describe("supabase/setup.sql", () => {
  it("matches the migrations and seed (run `pnpm db:bundle` after adding a migration)", () => {
    expect(readFileSync("supabase/setup.sql", "utf8")).toBe(buildBundle());
  });
});
