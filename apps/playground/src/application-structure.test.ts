import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const routesRoot = join(sourceRoot, "routes");

const expectedPublicFullPaths = [
  "/",
  "/api/chat",
  "/api/studio/diagrams/$diagramId",
  "/api/studio/projects",
  "/api/studio/projects/$projectId",
  "/api/studio/projects/from-artifact",
  "/api/v1/artifacts/$artifactId",
  "/api/v1/artifacts/$artifactId/patch",
  "/api/v1/canvases/create",
  "/api/v1/flowcharts/build",
  "/api/v1/generate",
  "/api/v1/mindmaps/build",
  "/api/v1/sequences/build",
  "/artifacts/$artifactId",
  "/artifacts/$artifactId/edit",
  "/codemode-export-harness",
  "/diagrams/$diagramId",
  "/diagrams/$diagramId/edit",
  "/examples/$exampleId",
  "/mcp",
  "/projects",
  "/projects/$projectId",
].sort();

const retiredGenericPaths = [
  "agent.server.ts",
  "api.server.test.ts",
  "api.server.ts",
  "artifact-view-client.ts",
  "browser-renderer.server.test.ts",
  "browser-renderer.server.ts",
  "cloudflare-bindings.server.ts",
  "home-url.ts",
  "mcp-docs.server.test.ts",
  "mcp-docs.server.ts",
  "mcp.server.test.ts",
  "mcp.server.ts",
  "studio-flowchart-tool.server.test.ts",
  "studio-flowchart-tool.server.ts",
  "usage-events.server.ts",
];

function sourceFilesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? sourceFilesUnder(path) : [path];
  });
}

function transportRouteFiles(): string[] {
  return [
    ...sourceFilesUnder(join(routesRoot, "api")).filter((path) =>
      path.endsWith(".ts"),
    ),
    join(routesRoot, "mcp.ts"),
  ].sort();
}

describe("Playground application structure", () => {
  it("keeps API and MCP route modules as thin server transport adapters", () => {
    const routeFiles = transportRouteFiles();

    expect(routeFiles.map((path) => relative(routesRoot, path))).toEqual([
      "api/chat.ts",
      "api/studio/diagrams/$diagramId.ts",
      "api/studio/projects.ts",
      "api/studio/projects/from-artifact.ts",
      "api/studio/projects_/$projectId.ts",
      "api/v1/artifacts/$artifactId.ts",
      "api/v1/artifacts/$artifactId/patch.ts",
      "api/v1/canvases/create.ts",
      "api/v1/flowcharts/build.ts",
      "api/v1/generate.ts",
      "api/v1/mindmaps/build.ts",
      "api/v1/sequences/build.ts",
      "mcp.ts",
    ]);

    for (const path of routeFiles) {
      const source = readFileSync(path, "utf8");
      const dynamicImports = [...source.matchAll(/import\("([^"]+)"\)/g)]
        .map((match) => match[1])
        .filter((specifier): specifier is string => specifier !== undefined);

      expect(source, path).toMatch(
        /^import \{ createFileRoute \} from "@tanstack\/react-router";/,
      );
      expect(source, path).not.toContain('from "@sketchi/');
      expect(source, path).not.toContain('from "cloudflare:');
      expect(source, path).not.toContain(
        'import "@tanstack/react-start/server-only"',
      );
      expect(source, path).not.toMatch(/export (?!const Route\b)/);
      expect(source.split("\n").length, path).toBeLessThanOrEqual(60);
      expect(dynamicImports.length, path).toBeGreaterThan(0);
      expect(
        dynamicImports.every((specifier) => specifier.startsWith("@/server/")),
        path,
      ).toBe(true);
    }
  });

  it("preserves the approved TanStack public full-path set", () => {
    const routeTree = readFileSync(
      join(sourceRoot, "routeTree.gen.ts"),
      "utf8",
    );
    const fullPaths = [...routeTree.matchAll(/fullPath: "([^"]+)";/g)]
      .map((match) => match[1])
      .filter((fullPath): fullPath is string => fullPath !== undefined);

    expect(new Set(fullPaths).size).toBe(fullPaths.length);
    expect(fullPaths.sort()).toEqual(expectedPublicFullPaths);
  });

  it("keeps app server domains out of client-facing source graphs", () => {
    const serverRoot = join(sourceRoot, "server");
    const serverFiles = sourceFilesUnder(serverRoot).filter((path) =>
      path.endsWith(".ts"),
    );
    const serverImplementations = serverFiles
      .filter((path) => path.endsWith(".server.ts"))
      .filter((path) => !path.endsWith(".server.test.ts"));

    for (const path of serverImplementations) {
      expect(readFileSync(path, "utf8"), path).toMatch(
        /^import "@tanstack\/react-start\/server-only";/,
      );
    }

    const clientFacingFiles = [
      ...sourceFilesUnder(join(sourceRoot, "components")),
      ...sourceFilesUnder(join(sourceRoot, "features")),
      ...sourceFilesUnder(routesRoot).filter(
        (path) =>
          !path.startsWith(join(routesRoot, "api")) &&
          path !== join(routesRoot, "mcp.ts"),
      ),
    ].filter((path) => /\.tsx?$/.test(path));

    for (const path of clientFacingFiles) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(
        /(?:from\s+|import\()["'][^"']*(?:\/|^)server\//,
      );
    }

    for (const path of serverFiles.filter(
      (path) => !relative(serverRoot, path).startsWith("chat/"),
    )) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(
        /(?:from\s+|import\()["'][^"']*(?:\/|^)chat\//,
      );
    }
  });

  it("removes the retired generic lib paths", () => {
    const libRoot = resolve(sourceRoot, "lib");

    for (const path of retiredGenericPaths) {
      expect(existsSync(join(libRoot, path)), path).toBe(false);
    }

    expect(
      sourceFilesUnder(libRoot)
        .map((path) => relative(libRoot, path))
        .sort(),
    ).toEqual(["utils.ts"]);
  });
});
