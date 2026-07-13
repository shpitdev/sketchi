// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("public SVG CORS policy", () => {
  it("allows cross-origin reads only for upload-ready SVG assets", () => {
    const policy = readFileSync(
      resolve(process.cwd(), "apps/icons/public/_headers"),
      "utf8",
    );

    const routes = policy
      .split("\n")
      .filter((line) => line.startsWith("/") && line.trim() !== "");

    expect(routes).toEqual(["/output/upload-ready/svg/*"]);
    expect(policy).toContain("Access-Control-Allow-Origin: *");
    expect(policy).toContain(
      "Access-Control-Allow-Methods: GET, HEAD, OPTIONS",
    );
  });
});
