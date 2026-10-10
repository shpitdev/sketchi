import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));

import {
  NODE_LOGO_ASSET_PATH,
  playgroundIconCatalog,
  type PlaygroundAssetsBinding,
} from "./icon-catalog.server";

function assetsBinding(files: Record<string, string>) {
  const requests: string[] = [];
  const origins: string[] = [];
  const binding: PlaygroundAssetsBinding = {
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      requests.push(url.pathname);
      origins.push(url.origin);
      const body = files[url.pathname];
      return body === undefined
        ? new Response("missing", { status: 404 })
        : new Response(body, { headers: { "Content-Type": "image/svg+xml" } });
    },
  };
  return { binding, origins, requests };
}

describe("playground icon catalog", () => {
  it("reads node logos from the Worker's static assets", async () => {
    const { binding, origins, requests } = assetsBinding({
      [`${NODE_LOGO_ASSET_PATH}docker.svg`]: "<svg/>",
    });
    const catalog = playgroundIconCatalog(
      binding,
      "https://playground.sketchi.app",
    );
    const docker = catalog.get("docker");
    if (!docker) throw new Error("Docker must be a node logo.");

    await expect(Effect.runPromise(catalog.loadSvg(docker))).resolves.toBe(
      "<svg/>",
    );
    expect(requests).toEqual(["/node-logos/docker.svg"]);
    // The request's own origin: local Vite dev rejects unknown hosts.
    expect(origins).toEqual(["https://playground.sketchi.app"]);
    expect(
      playgroundIconCatalog(binding, "https://playground.sketchi.app"),
    ).toBe(catalog);
  });

  it("reports a typed load error when the asset is missing", async () => {
    const catalog = playgroundIconCatalog(
      assetsBinding({}).binding,
      "http://127.0.0.1:6420",
    );
    const github = catalog.get("github");
    if (!github) throw new Error("GitHub must be a node logo.");

    const exit = await Effect.runPromiseExit(catalog.loadSvg(github));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("CodeModeIconLoadError");
  });
});
