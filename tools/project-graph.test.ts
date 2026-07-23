import { createProjectGraphAsync, readJsonFile } from "@nx/devkit";
import { ESLint } from "eslint";
import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
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
  "packages/observability",
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
  "packages/observability",
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
  "packages/observability/tsconfig.lib.json",
  "packages/studio/projects/tsconfig.lib.json",
  "packages/svg-excalidraw/tsconfig.lib.json",
  "tools/sketchi-generators/tsconfig.lib.json",
];
const reviewedEffectUnstableAdapterPaths = [
  "apps/cli/src/internal/effect-unstable-cli.ts",
];
const effectDependencyManifestPaths = [
  "apps/cli/package.json",
  "apps/eval-harness/package.json",
  "package.json",
  "packages/diagram/agent/package.json",
  "packages/diagram/core/package.json",
  "packages/diagram/generation/package.json",
  "packages/diagram/scenarios/package.json",
  "packages/observability/package.json",
  "packages/studio/projects/package.json",
];
const approvedRuntimeBoundaryFiles = [
  "apps/cli/src/main.ts",
  "apps/eval-harness/src/lib/generate-scenario.ts",
  "apps/playground/src/server/runtime/playground-runtime.server.ts",
  "packages/diagram/scenarios/src/cli.ts",
  "packages/diagram/scenarios/src/live-generator.ts",
  "scripts/pipelines/r2-catalog-smoke.mjs",
  "tools/harness-eval.ts",
];
const approvedManagedPromiseSiteCounts: Record<string, number> = {
  "apps/cli/scripts/build.mjs": 27,
  "apps/cli/scripts/bundle-report.mjs": 8,
  "apps/cli/scripts/package.mjs": 8,
  "apps/cli/scripts/smoke.mjs": 128,
  "apps/cli/src/filesystem.ts": 69,
  "apps/cli/src/generation.ts": 4,
  "apps/cli/src/png-renderer-runtime.ts": 30,
  "apps/cli/src/png-renderer.ts": 8,
  "apps/cli/src/share-protocol.ts": 12,
  "apps/cli/src/share.ts": 25,
  "apps/cli/vitest.config.mts": 1,
  "apps/eval-harness/src/lib/generate-scenario.ts": 6,
  "apps/eval-harness/src/routes/api/scenario-candidates.ts": 7,
  "apps/eval-harness/src/routes/index.tsx": 4,
  "apps/excalidraw/src/components/excalidraw-workspace/excalidraw-workspace.tsx": 3,
  "apps/excalidraw/src/components/svg-icon-workspace/svg-icon-workspace.tsx": 7,
  "apps/icons/src/components/icon-conversion-preview/icon-conversion-preview.tsx": 16,
  "apps/icons/src/components/icon-detail/icon-detail.tsx": 10,
  "apps/icons/src/routes/index.tsx": 7,
  "apps/playground/src/components/ai-elements/code-block.tsx": 9,
  "apps/playground/src/components/ai-elements/conversation.tsx": 1,
  "apps/playground/src/components/ai-elements/prompt-input.tsx": 27,
  "apps/playground/src/components/ai-elements/reasoning.tsx": 1,
  "apps/playground/src/features/artifacts/artifact-view-client.ts": 8,
  "apps/playground/src/routes/api/chat.ts": 6,
  "apps/playground/src/routes/api/studio/diagrams/$diagramId.ts": 5,
  "apps/playground/src/routes/api/studio/projects.ts": 5,
  "apps/playground/src/routes/api/studio/projects/from-artifact.ts": 5,
  "apps/playground/src/routes/api/studio/projects_/$projectId.ts": 5,
  "apps/playground/src/routes/api/v1/artifacts/$artifactId.ts": 6,
  "apps/playground/src/routes/api/v1/artifacts/$artifactId/patch.ts": 6,
  "apps/playground/src/routes/api/v1/flowcharts/build.ts": 6,
  "apps/playground/src/routes/api/v1/generate.ts": 6,
  "apps/playground/src/routes/api/v1/mindmaps/build.ts": 6,
  "apps/playground/src/routes/api/v1/sequences/build.ts": 6,
  "apps/playground/src/routes/artifacts/$artifactId.tsx": 3,
  "apps/playground/src/routes/codemode-export-harness.tsx": 5,
  "apps/playground/src/routes/diagrams/$diagramId.tsx": 4,
  "apps/playground/src/routes/diagrams_/$diagramId/edit.tsx": 4,
  "apps/playground/src/routes/index.tsx": 2,
  "apps/playground/src/routes/mcp.ts": 14,
  "apps/playground/src/routes/projects.tsx": 3,
  "apps/playground/src/routes/projects_/$projectId.tsx": 3,
  "apps/playground/src/server/ai/playground-ai-model.server.ts": 2,
  "apps/playground/src/server/bindings/studio-env.server.ts": 1,
  "apps/playground/src/server/chat/agent.server.ts": 6,
  "apps/playground/src/server/codemode/codemode-api.server.ts": 27,
  "apps/playground/src/server/codemode/codemode-browser-renderer.server.ts": 22,
  "apps/playground/src/server/codemode/codemode-http-schema.server.ts": 3,
  "apps/playground/src/server/codemode/codemode-mcp.server.ts": 26,
  "apps/playground/src/server/codemode/codemode-usage-events.server.ts": 8,
  "apps/playground/src/server/codemode/effect-mcp-adapter.server.ts": 7,
  "apps/playground/src/server/generation/generation-api.server.ts": 7,
  "apps/playground/src/server/runtime/playground-runtime.server.ts": 14,
  "apps/playground/src/server/studio/projects.server.ts": 3,
  "apps/web/src/components/copy-button/copy-button.tsx": 3,
  "apps/web/src/lib/surface-urls-rpc.ts": 3,
  "apps/web/src/routes/agents.tsx": 2,
  "apps/web/src/routes/docs.tsx": 2,
  "apps/web/src/routes/index.tsx": 2,
  "packages/diagram/agent/src/lib/code-mode-artifacts.ts": 18,
  "packages/diagram/generation/src/lib/cloudflare-google-ai-studio.ts": 7,
  "packages/diagram/scenarios/src/cli.ts": 10,
  "packages/diagram/scenarios/src/live-generator.ts": 10,
  "packages/diagram/scenarios/vitest.config.mts": 1,
  "packages/diagram/ui/src/components/excalidraw-scene-canvas/excalidraw-scene-canvas.tsx": 2,
  "packages/diagram/ui/src/components/scenario-playground/scenario-playground.tsx": 10,
  "packages/observability/vitest.config.mts": 1,
  "packages/studio/projects/src/client-api.ts": 20,
  "packages/studio/projects/src/server/bucket.ts": 23,
  "packages/studio/projects/src/server/http.ts": 2,
  "scripts/pipelines/r2-catalog-smoke.mjs": 10,
  "tools/harness-eval.ts": 8,
  "tools/sketchi-generators/src/generators/diagram-type/diagram-type.spec.ts": 6,
  "tools/sketchi-generators/src/generators/diagram-type/diagram-type.ts": 3,
  "tools/sketchi-generators/src/generators/ui-component/ui-component.spec.ts": 3,
  "tools/sketchi-generators/src/generators/ui-component/ui-component.ts": 3,
};
const approvedManagedPromiseFiles = Object.keys(
  approvedManagedPromiseSiteCounts,
).sort();
const approvedEffectDependencyVersions = new Set(["4.0.0-beta.99"]);
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

type PromiseOrchestrationKind =
  | "async function"
  | "await expression"
  | "Promise construction"
  | "Promise-producing call"
  | "Promise static call"
  | "thenable member access";

interface PromiseOrchestrationSite {
  readonly column: number;
  readonly kind: PromiseOrchestrationKind;
  readonly line: number;
}

function memberName(expression: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    (ts.isStringLiteral(expression.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(expression.argumentExpression))
  ) {
    return expression.argumentExpression.text;
  }
  return undefined;
}

function memberReceiver(expression: ts.Expression): ts.Expression | undefined {
  return ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
    ? expression.expression
    : undefined;
}

const promiseTypeAnchorPath = path.join(
  workspaceRoot,
  ".memory",
  "promise-type-anchor.d.ts",
);
const promiseTypeAnchorSource = [
  "declare const __promiseLikeAnchor: PromiseLike<any>;",
  "declare const __promiseConstructorAnchor: PromiseConstructor;",
].join("\n");
const promiseTypeCheckingSourcePaths: Record<string, string[]> = {
  "@sketchi/diagram-agent": ["packages/diagram/agent/src/index.ts"],
  "@sketchi/diagram-core": ["packages/diagram/core/src/index.ts"],
  "@sketchi/diagram-excalidraw": ["packages/diagram/excalidraw/src/index.ts"],
  "@sketchi/diagram-generation": ["packages/diagram/generation/src/index.ts"],
  "@sketchi/diagram-renderer": ["packages/diagram/renderer/src/index.ts"],
  "@sketchi/diagram-scenarios": ["packages/diagram/scenarios/src/index.ts"],
  "@sketchi/diagram-ui": ["packages/diagram/ui/src/index.ts"],
  "@sketchi/observability": ["packages/observability/src/index.ts"],
  "@sketchi/svg-excalidraw": ["packages/svg-excalidraw/src/index.ts"],
};

function createTypeCheckedProgram(
  rootNames: readonly string[],
  virtualSources: ReadonlyMap<string, string> = new Map(),
): ts.Program {
  const configPath = path.join(workspaceRoot, "tsconfig.base.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    workspaceRoot,
    { allowJs: true, checkJs: false, noEmit: true },
    configPath,
  );
  const compilerOptions: ts.CompilerOptions = {
    ...parsed.options,
    baseUrl: workspaceRoot,
    paths: {
      ...parsed.options.paths,
      ...promiseTypeCheckingSourcePaths,
    },
  };
  const sources = new Map(virtualSources);
  sources.set(promiseTypeAnchorPath, promiseTypeAnchorSource);
  const host = ts.createCompilerHost(compilerOptions, true);
  const defaultDirectoryExists = host.directoryExists?.bind(host);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  host.fileExists = (fileName) =>
    sources.has(path.resolve(fileName)) || defaultFileExists(fileName);
  host.directoryExists = (directoryName) => {
    const resolvedDirectory = `${path.resolve(directoryName)}${path.sep}`;
    return (
      [...sources.keys()].some((fileName) =>
        path.resolve(fileName).startsWith(resolvedDirectory),
      ) || defaultDirectoryExists?.(directoryName) === true
    );
  };
  host.readFile = (fileName) =>
    sources.get(path.resolve(fileName)) ?? defaultReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const sourceText = sources.get(path.resolve(fileName));
    return sourceText === undefined
      ? defaultGetSourceFile(fileName, languageVersion, onError, shouldCreate)
      : ts.createSourceFile(
          fileName,
          sourceText,
          languageVersion,
          true,
          ts.getScriptKindFromFileName(fileName),
        );
  };
  return ts.createProgram({
    host,
    options: compilerOptions,
    rootNames: [...rootNames, promiseTypeAnchorPath],
  });
}

function declaredVariableType(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  variableName: string,
): ts.Type {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === variableName
      ) {
        return checker.getTypeAtLocation(declaration.name);
      }
    }
  }
  throw new Error(`Missing type-checker anchor ${variableName}.`);
}

function promiseOrchestrationSites(
  program: ts.Program,
  sourceFile: ts.SourceFile,
): PromiseOrchestrationSite[] {
  const checker = program.getTypeChecker();
  const anchorFile = program.getSourceFile(promiseTypeAnchorPath);
  if (!anchorFile)
    throw new Error("Promise type-checker anchor was not loaded.");
  const promiseLikeType = declaredVariableType(
    checker,
    anchorFile,
    "__promiseLikeAnchor",
  );
  const promiseConstructorType = declaredVariableType(
    checker,
    anchorFile,
    "__promiseConstructorAnchor",
  );
  const sites: PromiseOrchestrationSite[] = [];
  const record = (node: ts.Node, kind: PromiseOrchestrationKind): void => {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    sites.push({
      column: location.character + 1,
      kind,
      line: location.line + 1,
    });
  };
  const isUsableType = (type: ts.Type): boolean =>
    (type.flags &
      (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) ===
    0;
  const isPromiseLikeType = (type: ts.Type): boolean => {
    if (!isUsableType(type)) return false;
    if (type.isUnionOrIntersection()) {
      return type.types.some(isPromiseLikeType);
    }
    const nonNullableType = checker.getNonNullableType(type);
    return (
      isUsableType(nonNullableType) &&
      checker.isTypeAssignableTo(nonNullableType, promiseLikeType)
    );
  };
  const isPromiseLike = (node: ts.Node): boolean =>
    isPromiseLikeType(checker.getTypeAtLocation(node));
  const isPromiseConstructor = (node: ts.Node): boolean => {
    const type = checker.getTypeAtLocation(node);
    return (
      isUsableType(type) &&
      checker.isTypeAssignableTo(type, promiseConstructorType)
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) {
      const signature = checker.getSignatureFromDeclaration(node);
      if (
        signature &&
        isPromiseLikeType(checker.getReturnTypeOfSignature(signature))
      ) {
        record(node, "async function");
      }
    }
    if (ts.isAwaitExpression(node) && isPromiseLike(node.expression)) {
      record(node, "await expression");
    }
    if (
      ts.isNewExpression(node) &&
      (isPromiseLike(node) || isPromiseConstructor(node.expression))
    ) {
      record(node, "Promise construction");
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const receiver = memberReceiver(expression);
      if (receiver && isPromiseConstructor(receiver)) {
        record(node, "Promise static call");
      } else if (
        receiver &&
        ["then", "catch", "finally"].includes(memberName(expression) ?? "") &&
        isPromiseLike(receiver)
      ) {
        record(node, "thenable member access");
      } else if (isPromiseLike(node)) {
        record(node, "Promise-producing call");
      }
    }
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      ["then", "catch", "finally"].includes(memberName(node) ?? "") &&
      isPromiseLike(node.expression) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      record(node, "thenable member access");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

function promiseProbeSites(
  sourceText: string,
  supportingSources: Readonly<Record<string, string>> = {},
): PromiseOrchestrationSite[] {
  const probeDirectory = path.join(workspaceRoot, ".memory", "promise-probe");
  const probePath = path.join(probeDirectory, "probe.ts");
  const virtualSources = new Map<string, string>([
    [probePath, sourceText],
    ...Object.entries(supportingSources).map(
      ([fileName, contents]) =>
        [path.join(probeDirectory, fileName), contents] as const,
    ),
  ]);
  const program = createTypeCheckedProgram(
    [...virtualSources.keys()],
    virtualSources,
  );
  const sourceFile = program.getSourceFile(probePath);
  if (!sourceFile) throw new Error("Promise probe source was not loaded.");
  return promiseOrchestrationSites(program, sourceFile);
}

function invalidEffectDependencyPins(
  manifest: PackageManifest,
): Array<{ dependency: string; version: string }> {
  const invalid: Array<{ dependency: string; version: string }> = [];
  for (const dependencies of [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ]) {
    for (const [dependency, version] of Object.entries(dependencies ?? {})) {
      if (
        (dependency === "effect" || dependency.startsWith("@effect/")) &&
        !approvedEffectDependencyVersions.has(version)
      ) {
        invalid.push({ dependency, version });
      }
    }
  }
  return invalid;
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
      expect(
        invalidEffectDependencyPins(manifest),
        `${packageJsonPath} has a non-exact or unapproved Effect dependency`,
      ).toEqual([]);
      for (const dependencies of [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.optionalDependencies,
        manifest.peerDependencies,
      ]) {
        expect(dependencies?.["@effect/cli"]).toBeUndefined();
      }
    }

    const actualEffectManifestPaths = packageJsonPaths
      .filter((packageJsonPath) => {
        const manifest = readJsonFile<PackageManifest>(
          path.join(workspaceRoot, packageJsonPath),
        );
        return [
          manifest.dependencies,
          manifest.devDependencies,
          manifest.optionalDependencies,
          manifest.peerDependencies,
        ].some((dependencies) =>
          Object.keys(dependencies ?? {}).some(
            (dependency) =>
              dependency === "effect" || dependency.startsWith("@effect/"),
          ),
        );
      })
      .sort();
    expect(actualEffectManifestPaths).toEqual(effectDependencyManifestPaths);

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
      [
        ...["apps", "packages", "tools"].map(
          (root) => `${root}/**/*.{ts,tsx,mts,cts,js,mjs}`,
        ),
        "scripts/pipelines/r2-catalog-smoke.mjs",
      ],
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

  it("prevents unmanaged Promise, schema, and runtime regressions", () => {
    const sourceFiles = globSync(
      [
        ...["apps", "packages", "tools"].map(
          (root) => `${root}/**/*.{ts,tsx,mts,cts,js,mjs}`,
        ),
        "scripts/pipelines/r2-catalog-smoke.mjs",
      ],
      {
        cwd: workspaceRoot,
        exclude: [
          "**/dist/**",
          "**/.output/**",
          "**/.wrangler/**",
          "**/*.test.*",
          "**/*.stories.*",
          "**/__tests__/**",
          "**/routeTree.gen.ts",
        ],
      },
    );

    const zodImports = sourceFiles.filter((sourceFile) =>
      /(?:from\s+|import\s*\()["']zod(?:\/[^"']*)?["']/.test(
        readFileSync(path.join(workspaceRoot, sourceFile), "utf8"),
      ),
    );
    expect(zodImports).toEqual([]);

    const promiseProgram = createTypeCheckedProgram(
      sourceFiles.map((sourceFile) => path.join(workspaceRoot, sourceFile)),
    );
    const managedPromiseSites = Object.fromEntries(
      sourceFiles
        .map((sourceFile) => {
          const absolutePath = path.join(workspaceRoot, sourceFile);
          const parsedSource = promiseProgram.getSourceFile(absolutePath);
          if (!parsedSource) {
            throw new Error(`Type checker did not load ${sourceFile}.`);
          }
          return [
            sourceFile,
            promiseOrchestrationSites(promiseProgram, parsedSource),
          ] as const;
        })
        .filter(([, sites]) => sites.length > 0),
    );
    const managedPromiseFiles = Object.keys(managedPromiseSites).sort();
    const managedPromiseSiteCounts = Object.fromEntries(
      managedPromiseFiles.map((sourceFile) => [
        sourceFile,
        managedPromiseSites[sourceFile]?.length ?? 0,
      ]),
    );
    expect(managedPromiseFiles).toEqual(approvedManagedPromiseFiles);
    expect(managedPromiseSiteCounts).toEqual(approvedManagedPromiseSiteCounts);

    const runtimeBoundaryFiles = sourceFiles
      .filter((sourceFile) =>
        /Effect\.run(?:Callback|Fork|Promise|PromiseExit|Sync|SyncExit)\s*\(|ManagedRuntime\.(?:make|makeEffect)\s*\(|NodeRuntime\.runMain\s*\(/.test(
          readFileSync(path.join(workspaceRoot, sourceFile), "utf8"),
        ),
      )
      .sort();
    expect(runtimeBoundaryFiles).toEqual(approvedRuntimeBoundaryFiles);
  }, 20_000);
});

describe("Effect structural guards", () => {
  it.each([
    ["top-level await fetch", "await fetch('https://example.test')"],
    [
      "exported arrow returning fetch",
      "export const request = () => fetch('https://example.test')",
    ],
    [
      "computed then consumer",
      'declare function foreign(): PromiseLike<number>; foreign()["then"]((value) => value)',
    ],
    ["async function", "export async function request() {}"],
    ["Promise construction", "new Promise(() => {})"],
    ["qualified Promise construction", "new globalThis.Promise(() => {})"],
    ["Promise resolve", "Promise.resolve(1)"],
    [
      "aliased Promise resolve",
      "const NativePromise = Promise; NativePromise.resolve(1)",
    ],
    ["Promise withResolvers", "Promise.withResolvers()"],
    [
      "direct then consumer",
      "declare const pending: Promise<number>; pending.then((value) => value)",
    ],
    [
      "computed catch consumer",
      'declare const pending: Promise<number>; pending["catch"](() => 0)',
    ],
    [
      "direct finally consumer",
      "declare const pending: Promise<number>; pending.finally(() => {})",
    ],
    [
      "indirect thenable",
      'declare function foreign(): PromiseLike<number>; const indirect = foreign; indirect()["then"]((value) => value)',
    ],
    [
      "detached thenable member access",
      "declare const pending: PromiseLike<number>; const detachedThen = pending.then",
    ],
    [
      "Promise-containing call union",
      "declare function maybe(): number | Promise<number>; maybe()",
    ],
    [
      "optional-chained Promise union consumer",
      "declare const pending: Promise<number> | undefined; pending?.then((value) => value)",
    ],
    [
      "MaybePromise alias",
      "type MaybePromise<T> = T | Promise<T>; declare function maybe(): MaybePromise<number>; maybe()",
    ],
    [
      "generic instantiated to a Promise union",
      "declare function instantiate<T>(): T; instantiate<string | Promise<number>>()",
    ],
    ["dynamic import", "import('./foreign.js')"],
  ])("detects %s orchestration", (_name, sourceText) => {
    expect(promiseProbeSites(sourceText)).not.toEqual([]);
  });

  it("detects an import-renamed Promise constructor by type identity", () => {
    expect(
      promiseProbeSites(
        'import { ReexportedPromise as ImportedPromise } from "./promise-reexport.js"; ImportedPromise.resolve(1)',
        {
          "promise-source.ts":
            "export const NativePromise = globalThis.Promise;",
          "promise-reexport.ts":
            'export { NativePromise as ReexportedPromise } from "./promise-source.js";',
        },
      ),
    ).not.toEqual([]);
  });

  it("does not confuse Effect error operators with Promise consumers", () => {
    expect(
      promiseProbeSites(
        "Effect.catch(program, recover); Effect['finally'](program, cleanup)",
      ),
    ).toEqual([]);
  });

  it("documents that deliberate any laundering is outside the gate", () => {
    expect(
      promiseProbeSites(
        "const deliberatelyErased: any = Promise; deliberatelyErased.resolve(1)",
      ),
    ).toEqual([]);
  });

  it("rejects a ranged pin for any @effect package", () => {
    expect(
      invalidEffectDependencyPins({
        dependencies: {
          "@effect/platform": "^4.0.0",
          "@effect/platform-node": "4.0.0-beta.99",
          effect: "4.0.0-beta.99",
        },
      }),
    ).toEqual([{ dependency: "@effect/platform", version: "^4.0.0" }]);
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
