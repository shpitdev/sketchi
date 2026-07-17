import { createProjectGraphAsync, readJsonFile } from "@nx/devkit";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const diagramPackages = [
  {
    name: "diagram-agent",
    npmName: "@sketchi/diagram-agent",
    root: "packages/diagram/agent",
    oldRoot: "packages/diagram-agent",
  },
  {
    name: "diagram-core",
    npmName: "@sketchi/diagram-core",
    root: "packages/diagram/core",
    oldRoot: "packages/diagram-core",
  },
  {
    name: "diagram-excalidraw",
    npmName: "@sketchi/diagram-excalidraw",
    root: "packages/diagram/excalidraw",
    oldRoot: "packages/diagram-excalidraw",
  },
  {
    name: "diagram-generation",
    npmName: "@sketchi/diagram-generation",
    root: "packages/diagram/generation",
    oldRoot: "packages/diagram-generation",
  },
  {
    name: "diagram-renderer",
    npmName: "@sketchi/diagram-renderer",
    root: "packages/diagram/renderer",
    oldRoot: "packages/diagram-renderer",
  },
  {
    name: "diagram-scenarios",
    npmName: "@sketchi/diagram-scenarios",
    root: "packages/diagram/scenarios",
    oldRoot: "packages/diagram-scenarios",
  },
];

describe("diagram package layout", () => {
  it("discovers the existing Nx projects at their nested roots", async () => {
    const graph = await createProjectGraphAsync({ exitOnError: true });

    for (const diagramPackage of diagramPackages) {
      expect(graph.nodes[diagramPackage.name]?.data.root).toBe(
        diagramPackage.root,
      );
    }
  });

  it("preserves npm identities and removes the old active directories", () => {
    for (const diagramPackage of diagramPackages) {
      const packageRoot = path.join(workspaceRoot, diagramPackage.root);
      const packageJson = readJsonFile<{ name: string }>(
        path.join(packageRoot, "package.json"),
      );

      expect(existsSync(packageRoot)).toBe(true);
      expect(packageJson.name).toBe(diagramPackage.npmName);
      expect(existsSync(path.join(workspaceRoot, diagramPackage.oldRoot))).toBe(
        false,
      );
    }

    expect(
      existsSync(path.join(workspaceRoot, "packages/diagram-studio-ui")),
    ).toBe(true);
    expect(
      existsSync(path.join(workspaceRoot, "packages/svg-excalidraw")),
    ).toBe(true);
  });
});

describe("diagram generation project boundaries", () => {
  it("keeps production generation independent from eval scenarios", async () => {
    const graph = await createProjectGraphAsync({ exitOnError: true });
    const generationTargets =
      graph.dependencies["diagram-generation"]?.map(
        (dependency) => dependency.target,
      ) ?? [];
    const scenarioTargets =
      graph.dependencies["diagram-scenarios"]?.map(
        (dependency) => dependency.target,
      ) ?? [];

    expect(generationTargets).not.toContain("diagram-scenarios");
    expect(scenarioTargets).toContain("diagram-generation");
  });
});
