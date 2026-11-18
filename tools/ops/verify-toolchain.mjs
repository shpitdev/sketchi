#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off -- The standalone toolchain verifier probes the actual installed executables and package manifests.

// Verifies the pinned toolchain. It runs before and without workspace dependencies (the release
// guard sets up no install), so it stays dependency-free JavaScript.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const config = readFileSync(join(root, "mise.toml"), "utf8");
const nodeVersion = config.match(/^node = "([\d.]+)"$/m)?.[1];
const pnpmVersion = config.match(/^"aqua:pnpm\/pnpm" = "([\d.]+)"$/m)?.[1];
const typeScriptApiPackageVersion = manifest.devDependencies.typescript.match(
	/^npm:@typescript\/typescript6@([\d.]+)$/,
)?.[1];
const nativeTypeScriptVersion =
	manifest.devDependencies["@typescript/native"].match(/^npm:typescript@([\d.]+)$/)?.[1];
const typeScriptApiVersion = "6.0.3";
const skipDependencies = process.argv.includes("--skip-dependencies");

assert(
	process.argv.slice(2).every((argument) => argument === "--skip-dependencies"),
	"usage: tools/ops/verify-toolchain.mjs [--skip-dependencies]",
);

assert.equal(
	typeScriptApiPackageVersion,
	"6.0.2",
	"pin the official TypeScript 6 compatibility package exactly",
);

assert.equal(manifest.engines.node, nodeVersion, "Node pins must agree");
assert.equal(manifest.engines.pnpm, pnpmVersion, "pnpm pins must agree");
assert.equal(manifest.packageManager, `pnpm@${pnpmVersion}`);
assert.equal(process.versions.node, nodeVersion, "Run with mise exec -- node");

function run(command, args) {
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr || result.error?.message);
	return result.stdout.trim();
}

const expectedPnpm = realpathSync(run("mise", ["which", "pnpm"]));
const pnpmName = process.platform === "win32" ? "pnpm.exe" : "pnpm";
const selectedPnpm = (process.env.PATH ?? "")
	.split(delimiter)
	.map((directory) => {
		try {
			return realpathSync(join(directory, pnpmName));
		} catch {
			return null;
		}
	})
	.find(Boolean);

assert.equal(
	selectedPnpm,
	expectedPnpm,
	"PATH must select mise's native pnpm directly, not a launcher/Corepack shim",
);
assert.equal(run("pnpm", ["--version"]), pnpmVersion);
assert.equal(
	run("pnpm", ["--config.verify-deps-before-run=false", "exec", "pnpm", "--version"]),
	pnpmVersion,
);

if (!skipDependencies) {
	assert.equal(run("pnpm", ["exec", "tsc", "--version"]), `Version ${nativeTypeScriptVersion}`);
	assert.equal(
		run("pnpm", ["exec", "effect-tsgo", `tsc@${nativeTypeScriptVersion}`, "--version"]),
		`Version ${nativeTypeScriptVersion}+effect-tsgo.${manifest.devDependencies["@effect/tsgo"]}`,
	);
	assert.equal(
		run("pnpm", ["exec", "effect-tsgo", "oxlint", "--version"]),
		`Version: ${manifest.devDependencies.oxlint}`,
	);
	assert.equal(manifest.devDependencies["@oxlint/plugins"], manifest.devDependencies.oxlint);
	assert.equal(
		run("node", [
			"--input-type=module",
			"--eval",
			'console.log((await import("typescript")).version)',
		]),
		typeScriptApiVersion,
		"the typescript module must expose the TypeScript 6 compiler API",
	);
}

console.log(
	skipDependencies
		? `Verified Node ${nodeVersion}, native pnpm ${pnpmVersion}, and nested pnpm without workspace dependencies`
		: `Verified Node ${nodeVersion}, native pnpm ${pnpmVersion}, nested pnpm, TypeScript ${typeScriptApiVersion} API, and native TypeScript ${nativeTypeScriptVersion}`,
);
