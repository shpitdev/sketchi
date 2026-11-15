import { createProjectGraphAsync, readJsonFile } from "@nx/devkit";
import { spawnSync } from "node:child_process";
import { existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
// pnpm resolves the exact runtime versions from the shared workspace catalog.
const approvedEffectDependencySpecifiers = new Set(["catalog:"]);
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
				workspacePackageGlobs().map((workspaceGlob) => `${workspaceGlob}/package.json`),
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
				workspacePackageGlobs().map((workspaceGlob) => `${workspaceGlob}/package.json`),
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
		expect([...composedApps].sort()).toEqual(["excalidraw", "icons", "playground"]);
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
