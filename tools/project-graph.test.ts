import { createProjectGraphAsync, readJsonFile } from "@nx/devkit";
import { spawnSync } from "node:child_process";
import { existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const requiredWorkspaceGlobs = ["apps/*", "packages/*", "packages/*/*", "tools/*"];
const intendedNxProjectRoots = [
	"apps/cli",
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
	"packages/icons/catalog",
	"packages/icons/community",
	"packages/icons/draw",
	"packages/observability",
	"packages/social-card",
	"packages/studio/projects",
	"packages/svg-excalidraw",
	"packages/ui",
	"tools/icon-batch",
	"tools/sketchi-generators",
];
const intendedWorkspacePackageRoots = intendedNxProjectRoots.filter(
	(projectRoot) => projectRoot !== "apps/native-conversion-storybook",
);
const intendedCompositeReferences = [
	"apps/cli/tsconfig.json",
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
	"packages/icons/catalog/tsconfig.lib.json",
	"packages/icons/community/tsconfig.lib.json",
	"packages/icons/draw/tsconfig.lib.json",
	"packages/observability/tsconfig.lib.json",
	"packages/social-card/tsconfig.lib.json",
	"packages/studio/projects/tsconfig.lib.json",
	"packages/svg-excalidraw/tsconfig.lib.json",
	"packages/ui/tsconfig.lib.json",
	"tools/icon-batch/tsconfig.json",
	"tools/sketchi-generators/tsconfig.lib.json",
];
// pnpm resolves the exact runtime versions from the shared workspace catalog.
const approvedEffectDependencySpecifiers = new Set(["catalog:"]);
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
			// The native compiler has its own release line, separate from the runtime catalog.
			const approved =
				dependency === "@effect/tsgo"
					? /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)
					: approvedEffectDependencySpecifiers.has(version);
			if ((dependency === "effect" || dependency.startsWith("@effect/")) && !approved) {
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
	const workspaceYaml = readFileSync(path.join(workspaceRoot, "pnpm-workspace.yaml"), "utf8");
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
		if (existsSync(path.join(workspaceRoot, configPath)) && isCompositeTsConfig(configPath)) {
			return configPath;
		}
	}
	return undefined;
}

interface OxlintReport {
	readonly diagnostics: ReadonlyArray<{
		readonly code?: string | null;
		readonly filename: string;
	}>;
}

function firstMissingDirectory(directory: string): string | undefined {
	let missing: string | undefined;
	for (let current = directory; !existsSync(current); current = path.dirname(current)) {
		missing = current;
	}
	return missing;
}

/**
 * Lints throwaway files through the real Oxlint CLI and repository config,
 * returning the sorted rule codes reported for each requested path.
 */
function lintProbes(probes: Readonly<Record<string, string>>): Record<string, string[]> {
	const files = Object.entries(probes).map(([filePath, source]) => {
		const extension = path.extname(filePath);
		const probePath = `${filePath.slice(0, -extension.length)}-${process.pid}${extension}`;
		return { filePath, probePath, source };
	});
	const createdDirectories: string[] = [];
	try {
		for (const { probePath, source } of files) {
			const absolutePath = path.join(workspaceRoot, probePath);
			const missing = firstMissingDirectory(path.dirname(absolutePath));
			if (missing) createdDirectories.push(missing);
			mkdirSync(path.dirname(absolutePath), { recursive: true });
			writeFileSync(absolutePath, `${source}\n`);
		}
		const result = spawnSync(
			path.join(workspaceRoot, "node_modules", ".bin", "effect-tsgo"),
			["oxlint", "--format", "json", ...files.map(({ probePath }) => probePath)],
			{ cwd: workspaceRoot, encoding: "utf8" },
		);
		if (result.error) throw result.error;
		const report: OxlintReport = JSON.parse(result.stdout);
		return Object.fromEntries(
			files.map(({ filePath, probePath }) => [
				filePath,
				report.diagnostics
					.filter((diagnostic) => diagnostic.filename === probePath)
					.map((diagnostic) => diagnostic.code ?? "unknown")
					.sort(),
			]),
		);
	} finally {
		for (const { probePath } of files) {
			rmSync(path.join(workspaceRoot, probePath), { force: true });
		}
		for (const directory of createdDirectories) {
			rmSync(directory, { force: true, recursive: true });
		}
	}
}

function unreasonedSuppressions(source: string): string[] {
	const directives = [
		/(?:oxlint|eslint)-disable(?:-next-line|-line)?\b(.*)/g,
		/(?:\/\/|\/\*+|^\s*\*)\s*@effect-diagnostics(?:-next-line)?\b([^\r\n]*?)(?=\*\/|[\r\n]|$)/gm,
	];
	const unreasoned: string[] = [];
	for (const directive of directives) {
		for (const match of source.matchAll(directive)) {
			if (!/\s--\s+\S/.test(match[1] ?? "")) unreasoned.push(match[0].trim());
		}
	}
	return unreasoned;
}

describe("diagram package layout", () => {
	it("discovers the existing Nx projects at their nested roots", async () => {
		const graph = await createProjectGraphAsync({ exitOnError: true });

		for (const diagramPackage of diagramPackages) {
			expect(graph.nodes[diagramPackage.name]?.data.root).toBe(diagramPackage.root);
		}
	});

	it("uses the approved npm identities and removes old active directories", () => {
		for (const diagramPackage of diagramPackages) {
			const packageRoot = path.join(workspaceRoot, diagramPackage.root);
			const packageJson = readJsonFile<{ name: string }>(path.join(packageRoot, "package.json"));

			expect(existsSync(packageRoot)).toBe(true);
			expect(packageJson.name).toBe(diagramPackage.npmName);
			expect(existsSync(path.join(workspaceRoot, diagramPackage.oldRoot))).toBe(false);
		}
		expect(existsSync(path.join(workspaceRoot, "packages/svg-excalidraw"))).toBe(true);
	});
});

describe("diagram generation project boundaries", () => {
	it("keeps production generation independent from eval scenarios", async () => {
		const graph = await createProjectGraphAsync({ exitOnError: true });
		const generationTargets =
			graph.dependencies["diagram-generation"]?.map((dependency) => dependency.target) ?? [];
		const scenarioTargets =
			graph.dependencies["diagram-scenarios"]?.map((dependency) => dependency.target) ?? [];

		expect(generationTargets).not.toContain("diagram-scenarios");
		expect(scenarioTargets).toContain("diagram-generation");
	});

	it("pins the runtime catalog and independently versioned Effect tooling", () => {
		const packageJsonPaths = [
			"package.json",
			...globSync(
				requiredWorkspaceGlobs.map((workspaceGlob) => `${workspaceGlob}/package.json`),
				{ cwd: workspaceRoot },
			),
		];

		for (const packageJsonPath of packageJsonPaths) {
			const manifest = readJsonFile<PackageManifest>(path.join(workspaceRoot, packageJsonPath));
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

		const rootManifest = readJsonFile<PackageManifest>(path.join(workspaceRoot, "package.json"));
		expect(rootManifest.dependencies?.["effect"]).toBe("catalog:");
		expect(rootManifest.devDependencies?.["@effect/vitest"]).toBe("catalog:");
		expect(readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf8")).not.toContain(
			"effect@3.",
		);
	});

	it("keeps Zod out of every workspace manifest", () => {
		const manifestPaths = [
			"package.json",
			...globSync(
				requiredWorkspaceGlobs.map((workspaceGlob) => `${workspaceGlob}/package.json`),
				{ cwd: workspaceRoot },
			),
		];
		for (const manifestPath of manifestPaths) {
			const manifest = readJsonFile<PackageManifest>(path.join(workspaceRoot, manifestPath));
			for (const dependencies of [
				manifest.dependencies,
				manifest.devDependencies,
				manifest.optionalDependencies,
				manifest.peerDependencies,
			]) {
				expect(
					Object.keys(dependencies ?? {}).filter(
						(dependency) => dependency === "zod" || dependency.startsWith("zod/"),
					),
					`${manifestPath} declares Zod`,
				).toEqual([]);
			}
		}
	});
});

describe("Effect dependency pins", () => {
	it("rejects a ranged pin for any @effect package", () => {
		expect(
			invalidEffectDependencyPins({
				dependencies: {
					"@effect/platform": "^4.0.0",
					"@effect/platform-node": "catalog:",
					"@effect/tsgo": "^0.69.0",
					effect: "catalog:",
				},
			}),
		).toEqual([
			{ dependency: "@effect/platform", version: "^4.0.0" },
			{ dependency: "@effect/tsgo", version: "^0.69.0" },
		]);
		expect(invalidEffectDependencyPins({ devDependencies: { "@effect/tsgo": "0.69.0" } })).toEqual(
			[],
		);
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
			.map((packageJsonPath) => normalizeWorkspacePath(path.dirname(packageJsonPath)))
			.sort();
		const nxPackageRoots = Object.values(graph.nodes)
			.map((node) => node.data.root)
			.filter((projectRoot) => existsSync(path.join(workspaceRoot, projectRoot, "package.json")))
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
		const rootConfig = readJsonFile<TsConfig>(path.join(workspaceRoot, "tsconfig.json"));
		const actualReferences = (rootConfig.references ?? [])
			.map(({ path: referencePath }) =>
				normalizeWorkspacePath(path.relative(workspaceRoot, resolveTsConfigPath(referencePath))),
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
		expect(actualReferences).not.toContain("apps/native-conversion-storybook/tsconfig.json");
	});

	it("tags every Nx project without allowing app dependency drift", async () => {
		const graph = await createProjectGraphAsync({ exitOnError: true });

		for (const node of Object.values(graph.nodes)) {
			const tags = node.data.tags ?? [];
			expect(tags.filter((tag) => tag.startsWith("scope:"))).toHaveLength(1);
			expect(tags.some((tag) => tag.startsWith("type:"))).toBe(true);
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
				.filter((target) => graph.nodes[target]?.data.tags?.includes("scope:app")),
		);
		expect([...composedApps].sort()).toEqual(["excalidraw", "icons"]);
	});

	it("enforces project boundaries in source, config, and Storybook files", () => {
		const results = lintProbes({
			"packages/diagram/agent/.storybook/boundary-probe.ts": 'import "@sketchi/diagram-scenarios";',
			"packages/diagram/agent/vitest.boundary-probe.mts": 'import "@sketchi/diagram-scenarios";',
			"apps/web/vite.boundary-probe.ts": 'import "../playground/src/routeTree.gen";',
			"apps/web/vite.boundary-allowed-probe.ts": [
				'import { localViteCacheDir } from "../../tools/local-dev-ports";',
				'import { workerProjectConfig } from "../../scripts/lib/worker-apps.mjs";',
				'void localViteCacheDir(workerProjectConfig("web").projectId);',
			].join("\n"),
		});

		for (const filePath of [
			"packages/diagram/agent/.storybook/boundary-probe.ts",
			"packages/diagram/agent/vitest.boundary-probe.mts",
			"apps/web/vite.boundary-probe.ts",
		]) {
			expect(results[filePath], filePath).toContain("@nx(enforce-module-boundaries)");
		}
		expect(results["apps/web/vite.boundary-allowed-probe.ts"]).toEqual([]);
	});

	it("permits Effect across projects while enforcing schema and React boundaries", () => {
		const results = lintProbes({
			"packages/diagram/core/src/effect-probe.ts": 'import { Effect } from "effect";\nvoid Effect;',
			"packages/diagram/renderer/src/effect-probe.ts":
				'import * as Schema from "effect/Schema";\nvoid Schema;',
			"apps/icons/src/effect-probe.ts":
				'import * as Atom from "effect/reactivity/Atom";\nvoid Atom;',
			"tools/sketchi-generators/src/effect-probe.ts": 'export type E = typeof import("effect");',
			"scripts/zod-probe.ts": 'import { z } from "zod";\nvoid z;',
			"scripts/deep-zod-probe.ts": 'import * as Core from "zod/v4/core";\nvoid Core;',
			"scripts/zod-type-probe.ts": 'export type Zod = typeof import("zod");',
			"apps/web/src/react-effect-probe.tsx": [
				'import { useEffect as useMountEffect } from "react";',
				"export function Probe() {",
				"  useMountEffect(() => {}, []);",
				"  return null;",
				"}",
			].join("\n"),
		});
		expect(results["packages/diagram/core/src/effect-probe.ts"]).toEqual([]);
		expect(results["packages/diagram/renderer/src/effect-probe.ts"]).toEqual([]);
		expect(results["apps/icons/src/effect-probe.ts"]).toEqual([]);
		expect(results["tools/sketchi-generators/src/effect-probe.ts"]).toEqual([]);
		expect(results["scripts/zod-probe.ts"]).toEqual(["eslint(no-restricted-imports)"]);
		expect(results["scripts/deep-zod-probe.ts"]).toEqual(["eslint(no-restricted-imports)"]);
		expect(results["scripts/zod-type-probe.ts"]).toEqual(["sketchi(no-restricted-import-types)"]);
		expect(results["apps/web/src/react-effect-probe.tsx"]).toEqual(["sketchi(no-react-effects)"]);
	});

	it("requires a reason on lint and Effect diagnostic directives", () => {
		const unreasoned: string[] = [];
		for (const sourceFile of globSync(
			["apps", "packages", "scripts", "tools"].map(
				(root) => `${root}/**/*.{ts,tsx,mts,cts,js,mjs,cjs}`,
			),
			{
				cwd: workspaceRoot,
				exclude: [
					"**/node_modules/**",
					"**/dist/**",
					"**/.output/**",
					"**/.wrangler/**",
					"**/routeTree.gen.ts",
				],
			},
		)) {
			const source = readFileSync(path.join(workspaceRoot, sourceFile), "utf8");
			for (const directive of unreasonedSuppressions(source)) {
				unreasoned.push(`${sourceFile}: ${directive}`);
			}
		}
		expect(unreasoned).toEqual([]);
	});
});

// Compose directive fixtures so this file does not itself contain suppressions.
const nextLineDirective = "@effect-diagnostics-next-line floatingEffect:off";
const fileDirective = "@effect-diagnostics floatingEffect:off";

it.each([
	["standalone line", "// ", nextLineDirective, "\nEffect.succeed(1);"],
	["trailing line", "export const marker = 1; // ", nextLineDirective, "\nEffect.succeed(1);"],
	["trailing file-wide", "export const marker = 1; // ", fileDirective, "\nEffect.succeed(1);"],
	["block", "/* ", nextLineDirective, " */\nEffect.succeed(1);"],
	["one-line JSDoc", "/** ", nextLineDirective, " */\nEffect.succeed(1);"],
	["multiline JSDoc", "/**\n * ", fileDirective, "\n */\nEffect.succeed(1);"],
])(
	"requires a nonempty reason in %s Effect diagnostic comments",
	(_name, prefix, directive, suffix) => {
		const source = (reason: string) => `${prefix}${directive}${reason}${suffix}`;
		expect(unreasonedSuppressions(source(""))).toHaveLength(1);
		expect(unreasonedSuppressions(source(" -- "))).toHaveLength(1);
		expect(unreasonedSuppressions(source(" -- Required synchronous host boundary"))).toEqual([]);
	},
);
