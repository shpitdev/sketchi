// @vitest-environment node

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("public icon assets", () => {
  it("does not serve pipeline reports or source review data", () => {
    const publicRoot = resolve(process.cwd(), "apps/icons/public");
    expect(existsSync(resolve(publicRoot, "output/reports"))).toBe(false);
    expect(existsSync(resolve(publicRoot, "output/review"))).toBe(false);
    expect(existsSync(resolve(publicRoot, "icons-manifest.json"))).toBe(true);
  });
});
