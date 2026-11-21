import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/dashboard?plan=pro_monthly", "/dashboard?plan=pro_monthly"],
    ["/admin/orders", "/admin/orders"],
  ])("keeps same-site path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "dashboard", "/\tfoo"])(
    "falls back for unsafe value %s",
    (input) => {
      expect(safeNextPath(input)).toBe("/dashboard");
    },
  );

  it("uses a custom fallback", () => {
    expect(safeNextPath("//x", "/")).toBe("/");
  });
});
