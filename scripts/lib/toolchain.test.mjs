import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("mise, metadata, and running/nested executables select one project toolchain", () => {
	const result = spawnSync(
		process.execPath,
		[fileURLToPath(new URL("../verify-toolchain.mjs", import.meta.url))],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(
		result.stdout,
		/native pnpm .*, nested pnpm, TypeScript .* API, and native TypeScript/,
	);
});

test("project mise wins over a legacy launcher prepended after inherited activation", () => {
	const memory = new URL("../../.memory/", import.meta.url);
	mkdirSync(memory, { recursive: true });
	const legacy = mkdtempSync(join(memory.pathname, "legacy-pnpm-test-"));
	const launcher = join(legacy, "pnpm");
	writeFileSync(launcher, "#!/bin/sh\necho legacy-launcher-must-not-run >&2\nexit 86\n");
	chmodSync(launcher, 0o755);
	const script = `
    set -eu
    eval "$(mise activate bash)"
    eval "$(mise hook-env -s bash)"
    export PATH="$LEGACY_BIN:$PATH"
    test "$(command -v pnpm)" = "$LEGACY_BIN/pnpm"
    mise exec -- node scripts/verify-toolchain.mjs
  `;
	const env = { ...process.env, LEGACY_BIN: legacy };
	delete env.MISE_ACTIVATE_AGGRESSIVE;
	try {
		const control = spawnSync("bash", ["-c", script], {
			encoding: "utf8",
			env: { ...env, MISE_ACTIVATE_AGGRESSIVE: "false" },
		});
		assert.notEqual(control.status, 0);
		assert.match(control.stderr, /PATH must select mise's native pnpm directly/);
		const fixed = spawnSync("bash", ["-c", script], { encoding: "utf8", env });
		assert.equal(fixed.status, 0, fixed.stderr);
		assert.match(
			fixed.stdout,
			/native pnpm .*, nested pnpm, TypeScript .* API, and native TypeScript/,
		);
	} finally {
		rmSync(legacy, { recursive: true, force: true });
	}
});

test("dependency-free setup still verifies native mise tools", () => {
	const memory = new URL("../../.memory/", import.meta.url);
	mkdirSync(memory, { recursive: true });
	const workspace = mkdtempSync(join(memory.pathname, "no-deps-toolchain-test-"));
	mkdirSync(join(workspace, "scripts"));
	for (const path of ["mise.toml", "package.json"]) {
		copyFileSync(new URL(`../../${path}`, import.meta.url), join(workspace, path));
	}
	copyFileSync(
		new URL("../verify-toolchain.mjs", import.meta.url),
		join(workspace, "scripts/verify-toolchain.mjs"),
	);
	const env = {
		...process.env,
		MISE_STATE_DIR: join(workspace, "mise-state"),
	};

	try {
		assert.equal(
			existsSync(join(workspace, "node_modules")),
			false,
			"dependency-free fixture must start without node_modules",
		);
		for (const config of [
			fileURLToPath(new URL("../../mise.toml", import.meta.url)),
			join(workspace, "mise.toml"),
		]) {
			const trust = spawnSync("mise", ["trust", config], {
				cwd: workspace,
				encoding: "utf8",
				env,
			});
			assert.equal(trust.status, 0, trust.stderr);
		}
		const result = spawnSync(
			process.execPath,
			["scripts/verify-toolchain.mjs", "--skip-dependencies"],
			{
				cwd: workspace,
				encoding: "utf8",
				env,
			},
		);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /nested pnpm without workspace dependencies/);
		assert.equal(
			existsSync(join(workspace, "node_modules")),
			false,
			"dependency-free verification must not materialize node_modules",
		);
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
});

test("dependency-installing CI jobs use the shared mise setup", () => {
	const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
	for (const file of [
		"app-preview.yml",
		"app-production-deploy.yml",
		"changesets.yml",
		"ci.yml",
		"release.yml",
	]) {
		const workflow = read(`.github/workflows/${file}`);
		assert.doesNotMatch(workflow, /pnpm\/action-setup|actions\/setup-node|node-version:/);
		assert.match(workflow, /uses: \.\/\.github\/actions\/setup-workspace/);
	}
	const ci = read(".github/workflows/ci.yml");
	assert.match(ci, /pnpm nx run-many -t typecheck-native/);
	assert.match(ci, /pnpm exec tsc6 -b --pretty false/);
	assert.doesNotMatch(ci, /tsgo|typecheck-tsgo/);
	const setup = read(".github/actions/setup-workspace/action.yml");
	assert.match(setup, /node scripts\/verify-toolchain\.mjs --skip-dependencies/);
	assert.match(setup, /INSTALL_DEPENDENCIES/);
});

test("pnpm enforces maturity and build approvals without age exceptions", () => {
	const workspace = readFileSync(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8");
	assert.match(workspace, /minimumReleaseAge: 1440/);
	assert.match(workspace, /minimumReleaseAgeStrict: true/);
	assert.match(workspace, /pmOnFail: error/);
	assert.match(workspace, /allowBuilds:/);
	assert.doesNotMatch(workspace, /minimumReleaseAgeExclude|dangerouslyAllowAllBuilds/);
});
