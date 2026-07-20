import { createProjectGraphAsync, readJsonFile } from "@nx/devkit";
import { ESLint } from "eslint";
import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const requiredWorkspaceGlobs = [
  "apps/*",
  "packages/*",
  "packages/*/*",
  "tools/*",
];
const intendedNxProjectRoots = [
  "apps/cli",
  "apps/eval-harness",
  "apps/excalidraw",
  "apps/icons",
  "apps/native-conversion-storybook",
  "apps/playground",
  "apps/web",
  "packages/diagram/agent",
  "packages/diagram/core",
  "packages/diagram/excalidraw",
  "packages/diagram/generation",
  "packages/diagram/renderer",
  "packages/diagram/scenarios",
  "packages/diagram/ui",
  "packages/studio/projects",
  "packages/svg-excalidraw",
  "tools/sketchi-generators",
];
const intendedWorkspacePackageRoots = intendedNxProjectRoots.filter(
  (projectRoot) => projectRoot !== "apps/native-conversion-storybook",
);
const effectAuthoritativeProjectRoots = [
  "apps/cli",
  "apps/eval-harness",
  "apps/playground",
  "packages/diagram/agent",
  "packages/diagram/generation",
  "packages/diagram/scenarios",
  "packages/studio/projects",
];
const effectPureProjectRoots = [
  "packages/diagram/core",
  "packages/diagram/excalidraw",
  "packages/diagram/renderer",
  "packages/svg-excalidraw",
];
const effectMigrationReadyProjectRoots: string[] = [];
const effectSchemaBoundaryFiles = new Set([
  "packages/diagram/core/src/diagram-types/flowchart.ts",
  "packages/diagram/core/src/diagram-types/mindmap.ts",
  "packages/diagram/core/src/intermediate.ts",
]);
const frameworkNativeProjectRoots = [
  "apps/excalidraw",
  "apps/icons",
  "apps/native-conversion-storybook",
  "apps/web",
  "packages/diagram/ui",
  "tools/sketchi-generators",
];
const intendedCompositeReferences = [
  "apps/cli/tsconfig.json",
  "apps/eval-harness/tsconfig.json",
  "apps/excalidraw/tsconfig.json",
  "apps/icons/tsconfig.json",
  "apps/playground/tsconfig.json",
  "apps/web/tsconfig.json",
  "packages/diagram/agent/tsconfig.lib.json",
  "packages/diagram/core/tsconfig.lib.json",
  "packages/diagram/excalidraw/tsconfig.lib.json",
  "packages/diagram/generation/tsconfig.lib.json",
  "packages/diagram/renderer/tsconfig.lib.json",
  "packages/diagram/scenarios/tsconfig.lib.json",
  "packages/diagram/ui/tsconfig.lib.json",
  "packages/studio/projects/tsconfig.lib.json",
  "packages/svg-excalidraw/tsconfig.lib.json",
  "tools/sketchi-generators/tsconfig.lib.json",
];
const reviewedEffectUnstableAdapterPaths = [
  "apps/cli/src/internal/effect-unstable-cli.ts",
];
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
  {
    name: "diagram-ui",
    npmName: "@sketchi/diagram-ui",
    root: "packages/diagram/ui",
    oldRoot: ["packages", ["diagram", "studio", "ui"].join("-")].join("/"),
  },
];

interface TsConfig {
  compilerOptions?: {
    composite?: boolean;
  };
  extends?: string;
  references?: Array<{ path: string }>;
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function normalizeWorkspacePath(filePath: string): string {
  return filePath.replaceAll(path.sep, "/").replace(/^\.\//, "");
}

function workspacePackageGlobs(): string[] {
  const workspaceYaml = readFileSync(
    path.join(workspaceRoot, "pnpm-workspace.yaml"),
    "utf8",
  );
  const lines = workspaceYaml.split("\n");
  const packagesLine = lines.findIndex((line) => line === "packages:");
  expect(packagesLine).toBeGreaterThanOrEqual(0);

  const globs: string[] = [];
  for (const line of lines.slice(packagesLine + 1)) {
    const match = line.match(/^\s{2}-\s+["']([^"']+)["']\s*$/);
    if (match?.[1]) {
      globs.push(match[1]);
      continue;
    }
    if (line.trim()) break;
  }
  return globs;
}

function resolveTsConfigPath(configPath: string): string {
  const absolutePath = path.resolve(workspaceRoot, configPath);
  if (path.extname(absolutePath)) return absolutePath;
  return path.join(absolutePath, "tsconfig.json");
}

function isCompositeTsConfig(configPath: string): boolean {
  const absolutePath = resolveTsConfigPath(configPath);
  const config = readJsonFile<TsConfig>(absolutePath);
  if (config.compilerOptions?.composite !== undefined) {
    return config.compilerOptions.composite;
  }
  if (!config.extends) return false;

  const parentPath = path.resolve(path.dirname(absolutePath), config.extends);
  return isCompositeTsConfig(parentPath);
}

function projectReferenceConfig(projectRoot: string): string | undefined {
  for (const configName of ["tsconfig.lib.json", "tsconfig.json"]) {
    const configPath = path.posix.join(projectRoot, configName);
    if (
      existsSync(path.join(workspaceRoot, configPath)) &&
      isCompositeTsConfig(configPath)
    ) {
      return configPath;
    }
  }
  return undefined;
}

describe("diagram package layout", () => {
  it("discovers the existing Nx projects at their nested roots", async () => {
    const graph = await createProjectGraphAsync({ exitOnError: true });

    for (const diagramPackage of diagramPackages) {
      expect(graph.nodes[diagramPackage.name]?.data.root).toBe(
        diagramPackage.root,
      );
    }
  });

  it("uses the approved npm identities and removes old active directories", () => {
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

  it("classifies every project and confines Effect to authoritative or schema-boundary code", () => {
    const classifiedRoots = [
      ...effectAuthoritativeProjectRoots,
      ...effectPureProjectRoots,
      ...effectMigrationReadyProjectRoots,
      ...frameworkNativeProjectRoots,
    ].sort();
    expect(classifiedRoots).toEqual(intendedNxProjectRoots);
    expect(new Set(classifiedRoots).size).toBe(classifiedRoots.length);

    for (const projectRoot of [
      ...effectPureProjectRoots,
      ...frameworkNativeProjectRoots,
    ]) {
      const sourceFiles = globSync(
        `${projectRoot}/**/*.{ts,tsx,mts,cts,js,mjs}`,
        {
          cwd: workspaceRoot,
          exclude: ["**/dist/**", "**/.output/**", "**/.wrangler/**"],
        },
      );

      for (const sourceFile of sourceFiles) {
        if (effectSchemaBoundaryFiles.has(sourceFile)) continue;
        const source = readFileSync(
          path.join(workspaceRoot, sourceFile),
          "utf8",
        );
        expect(source, `${sourceFile} imports Effect`).not.toMatch(
          /(?:from\s+|import\s*\()["'](?:effect(?:\/[^"']*)?|@effect\/[^"']+)["']/,
        );
      }
    }
  });

  it("pins one Effect v4 substrate and rejects unreviewed unstable imports", () => {
    const packageJsonPaths = [
      "package.json",
      ...globSync(
        requiredWorkspaceGlobs.map(
          (workspaceGlob) => `${workspaceGlob}/package.json`,
        ),
        { cwd: workspaceRoot },
      ),
    ];

    for (const packageJsonPath of packageJsonPaths) {
      const manifest = readJsonFile<PackageManifest>(
        path.join(workspaceRoot, packageJsonPath),
      );
      for (const dependencies of [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.optionalDependencies,
        manifest.peerDependencies,
      ]) {
        if (dependencies?.["effect"] !== undefined) {
          expect(dependencies["effect"]).toBe("4.0.0-beta.99");
        }
        if (dependencies?.["@effect/vitest"] !== undefined) {
          expect(dependencies["@effect/vitest"]).toBe("4.0.0-beta.99");
        }
      }
    }

    const rootManifest = readJsonFile<PackageManifest>(
      path.join(workspaceRoot, "package.json"),
    );
    expect(rootManifest.dependencies?.["effect"]).toBe("4.0.0-beta.99");
    expect(rootManifest.devDependencies?.["@effect/vitest"]).toBe(
      "4.0.0-beta.99",
    );
    expect(
      readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf8"),
    ).not.toContain("effect@3.");

    const sourceFiles = globSync(
      ["apps", "packages", "tools"].map(
        (root) => `${root}/**/*.{ts,tsx,mts,cts,js,mjs}`,
      ),
      {
        cwd: workspaceRoot,
        exclude: ["**/dist/**", "**/.output/**", "**/.wrangler/**"],
      },
    );
    const unstableImportPaths = sourceFiles
      .filter((sourceFile) =>
        /["']effect\/unstable\//.test(
          readFileSync(path.join(workspaceRoot, sourceFile), "utf8"),
        ),
      )
      .sort();
    expect(unstableImportPaths).toEqual(reviewedEffectUnstableAdapterPaths);
    for (const sourceFile of unstableImportPaths) {
      expect(sourceFile).toMatch(/\/src\/internal\/effect-unstable-[^/]+\.ts$/);
    }
  });
});

describe("workspace project membership", () => {
  it("keeps pnpm importers aligned with package-backed Nx roots", async () => {
    const graph = await createProjectGraphAsync({ exitOnError: true });
    const globs = workspacePackageGlobs();
    const pnpmRoots = globSync(
      globs.map((workspaceGlob) => `${workspaceGlob}/package.json`),
      { cwd: workspaceRoot },
    )
      .map((packageJsonPath) =>
        normalizeWorkspacePath(path.dirname(packageJsonPath)),
      )
      .sort();
    const nxPackageRoots = Object.values(graph.nodes)
      .map((node) => node.data.root)
      .filter((projectRoot) =>
        existsSync(path.join(workspaceRoot, projectRoot, "package.json")),
      )
      .sort();
    const nxRoots = Object.values(graph.nodes)
      .map((node) => node.data.root)
      .sort();

    expect(globs).toEqual(requiredWorkspaceGlobs);
    expect(nxRoots).toEqual(intendedNxProjectRoots);
    expect(nxPackageRoots).toEqual(intendedWorkspacePackageRoots);
    expect(pnpmRoots).toEqual(intendedWorkspacePackageRoots);
  });

  it("references every composite app, package, and generator project", async () => {
    const graph = await createProjectGraphAsync({ exitOnError: true });
    const rootConfig = readJsonFile<TsConfig>(
      path.join(workspaceRoot, "tsconfig.json"),
    );
    const actualReferences = (rootConfig.references ?? [])
      .map(({ path: referencePath }) =>
        normalizeWorkspacePath(
          path.relative(workspaceRoot, resolveTsConfigPath(referencePath)),
        ),
      )
      .sort();
    const discoveredCompositeReferences = Object.values(graph.nodes)
      .map((node) => projectReferenceConfig(node.data.root))
      .filter((configPath): configPath is string => configPath !== undefined)
      .sort();

    expect(new Set(actualReferences).size).toBe(actualReferences.length);
    expect(actualReferences).toEqual(intendedCompositeReferences);
    expect(discoveredCompositeReferences).toEqual(intendedCompositeReferences);
    for (const referencePath of actualReferences) {
      expect(isCompositeTsConfig(referencePath)).toBe(true);
    }
    expect(actualReferences).not.toContain(
      "apps/native-conversion-storybook/tsconfig.json",
    );
  });

  it("tags and lints every Nx project without allowing app dependency drift", async () => {
    const graph = await createProjectGraphAsync({ exitOnError: true });

    for (const node of Object.values(graph.nodes)) {
      const tags = node.data.tags ?? [];
      expect(tags.filter((tag) => tag.startsWith("scope:"))).toHaveLength(1);
      expect(tags.some((tag) => tag.startsWith("type:"))).toBe(true);
      expect(node.data.targets?.lint).toBeDefined();
    }

    for (const [source, dependencies] of Object.entries(graph.dependencies)) {
      for (const dependency of dependencies) {
        const targetTags = graph.nodes[dependency.target]?.data.tags ?? [];
        if (!targetTags.includes("scope:app")) continue;

        expect(graph.nodes[source]?.data.tags).toContain("scope:composition");
      }
    }

    const composedApps = new Set(
      (graph.dependencies["native-conversion-storybook"] ?? [])
        .map((dependency) => dependency.target)
        .filter((target) =>
          graph.nodes[target]?.data.tags?.includes("scope:app"),
        ),
    );
    expect([...composedApps].sort()).toEqual(["excalidraw", "icons"]);
  });

  it("enforces project boundaries in source, config, and Storybook files", async () => {
    const eslint = new ESLint({ cwd: workspaceRoot });
    const forbiddenImports = [
      {
        filePath: "packages/diagram/agent/.storybook/boundary-probe.ts",
        source: 'import "@sketchi/diagram-scenarios";',
      },
      {
        filePath: "packages/diagram/agent/vitest.boundary-probe.mts",
        source: 'import "@sketchi/diagram-scenarios";',
      },
      {
        filePath: "apps/web/vite.boundary-probe.ts",
        source: 'import "../playground/src/routeTree.gen";',
      },
    ];

    for (const { filePath, source } of forbiddenImports) {
      const [result] = await eslint.lintText(source, {
        filePath: path.join(workspaceRoot, filePath),
      });
      expect(result?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: "@nx/enforce-module-boundaries",
            severity: 2,
          }),
        ]),
      );
    }

    const [workspaceConfigResult] = await eslint.lintText(
      [
        'import { localViteCacheDir } from "../../tools/local-dev-ports";',
        'import { workerProjectConfig } from "../../scripts/lib/worker-apps.mjs";',
        'void localViteCacheDir(workerProjectConfig("web").projectId);',
      ].join("\n"),
      { filePath: path.join(workspaceRoot, "apps/web/vite.config.ts") },
    );
    expect(workspaceConfigResult?.messages).toEqual([]);
  });
});
