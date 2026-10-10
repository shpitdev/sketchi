import { nodeLogoIcons } from "@sketchi/icon-catalog/catalog";
import nodeLogoSvgs from "@sketchi/icon-catalog/node-logo-svgs";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { cliIconCatalog } from "./icon-catalog.js";

describe("CLI icon catalog", () => {
  it("bundles a normalized SVG for every eligible node logo", async () => {
    expect(Object.keys(nodeLogoSvgs).sort()).toEqual(
      nodeLogoIcons.map((icon) => icon.slug).sort(),
    );
    const docker = cliIconCatalog.get("docker");
    if (!docker) throw new Error("Docker must be a node logo.");
    const svg = await Effect.runPromise(cliIconCatalog.loadSvg(docker));
    expect(svg).toMatch(/^<svg\b[^>]* width="512" height="512"/u);
  });

  it("does not offer wordmarks or oversized marks", () => {
    expect(cliIconCatalog.get("docker-text")).toBeUndefined();
    expect(cliIconCatalog.get("tanstack")).toBeUndefined();
    for (const slug of ["constructor", "__proto__", "toString"]) {
      expect(cliIconCatalog.get(slug), slug).toBeUndefined();
    }
    expect(cliIconCatalog.search("kubernetes", 3)[0]?.slug).toBe("kubernetes");
  });
});
