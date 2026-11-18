// `tools/ops/verify-toolchain.mjs` against the real mise installation.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, onTestFinished, test } from "vitest";

import { repoRoot } from "./harness";

const verifier = join(repoRoot, "tools/ops/verify-toolchain.mjs");

/** A directory under .memory, which mise trusts as part of the project. */
function projectScratch(prefix: string) {
	const memory = join(repoRoot, ".memory");
	mkdirSync(memory, { recursive: true });
	const dir = mkdtempSync(join(memory, prefix));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

test("mise, metadata, and running/nested executables select one project toolchain", () => {
	const result = spawnSync(process.execPath, [verifier], { encoding: "utf8" });
	expect(result.status, result.stderr).toBe(0);
	expect(result.stdout).toMatch(
		/native pnpm .*, nested pnpm, TypeScript .* API, and native TypeScript/,
	);
});

test("project mise wins over a legacy launcher prepended after inherited activation", () => {
	const legacy = projectScratch("legacy-pnpm-test-");
	writeFileSync(
		join(legacy, "pnpm"),
		"#!/bin/sh\necho legacy-launcher-must-not-run >&2\nexit 86\n",
		{
			mode: 0o755,
		},
	);
	const script = `
    set -eu
    eval "$(mise activate bash)"
    eval "$(mise hook-env -s bash)"
    export PATH="$LEGACY_BIN:$PATH"
    test "$(command -v pnpm)" = "$LEGACY_BIN/pnpm"
    mise exec -- node tools/ops/verify-toolchain.mjs
  `;
	const env: NodeJS.ProcessEnv = { ...process.env, LEGACY_BIN: legacy };
	delete env["MISE_ACTIVATE_AGGRESSIVE"];
	const control = spawnSync("bash", ["-c", script], {
		cwd: repoRoot,
		encoding: "utf8",
		env: { ...env, MISE_ACTIVATE_AGGRESSIVE: "false" },
	});
	expect(control.status).not.toBe(0);
	expect(control.stderr).toMatch(/PATH must select mise's native pnpm directly/);
	const fixed = spawnSync("bash", ["-c", script], { cwd: repoRoot, encoding: "utf8", env });
	expect(fixed.status, fixed.stderr).toBe(0);
	expect(fixed.stdout).toMatch(
		/native pnpm .*, nested pnpm, TypeScript .* API, and native TypeScript/,
	);
});

test("dependency-free setup still verifies native mise tools without installing anything", () => {
	const workspace = projectScratch("no-deps-toolchain-test-");
	mkdirSync(join(workspace, "tools/ops"), { recursive: true });
	for (const path of ["mise.toml", "package.json"])
		copyFileSync(join(repoRoot, path), join(workspace, path));
	copyFileSync(verifier, join(workspace, "tools/ops/verify-toolchain.mjs"));
	const env = { ...process.env, MISE_STATE_DIR: join(workspace, "mise-state") };
	for (const config of [join(repoRoot, "mise.toml"), join(workspace, "mise.toml")]) {
		const trust = spawnSync("mise", ["trust", config], { cwd: workspace, encoding: "utf8", env });
		expect(trust.status, trust.stderr).toBe(0);
	}
	const result = spawnSync(
		process.execPath,
		["tools/ops/verify-toolchain.mjs", "--skip-dependencies"],
		{
			cwd: workspace,
			encoding: "utf8",
			env,
		},
	);
	expect(result.status, result.stderr).toBe(0);
	expect(result.stdout).toMatch(/nested pnpm without workspace dependencies/);
	expect(existsSync(join(workspace, "node_modules"))).toBe(false);
});
