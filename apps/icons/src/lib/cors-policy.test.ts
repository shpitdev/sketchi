// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { corsJson, corsPreflight } from "./cors-policy";

describe("public CORS policy", () => {
  it("covers static SVG, API, and MCP routes", () => {
    const policy = readFileSync(
      resolve(process.cwd(), "apps/icons/public/_headers"),
      "utf8",
    );
    const routes = policy
      .split("\n")
      .filter((line) => line.startsWith("/") && line.trim() !== "");
    expect(routes).toEqual([
      "/output/upload-ready/svg/*",
      "/api/*",
      "/mcp",
      "/icons-manifest.json",
    ]);
    expect(policy).toContain("Access-Control-Allow-Origin: *");
    expect(policy).toContain("MCP-Protocol-Version");
  });

  it("adds permissive CORS to dynamic responses and preflight", async () => {
    const response = corsJson({ ok: true });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "GET",
    );
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(corsPreflight().status).toBe(204);
  });
});
