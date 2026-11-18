// @effect-diagnostics nodeBuiltinImport:off -- The operations harness starts real child commands and constructs temporary checkout files.

import { execFileSync, spawn, spawnSync, type SpawnOptions } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { onTestFinished } from "vitest";

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const jiti = join(repoRoot, "node_modules/.bin/jiti");
export const opsMain = join(repoRoot, "tools/ops/src/main.ts");

export function scratch(prefix: string) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** Runs the real `ops` entrypoint to completion. */
export function runOps(
	args: readonly string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
	const result = spawnSync(jiti, [opsMain, ...args], {
		cwd: options.cwd ?? repoRoot,
		encoding: "utf8",
		env: { ...process.env, ...options.env },
	});
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Starts the real `ops` entrypoint without waiting for it. */
export function startOps(args: readonly string[], options: SpawnOptions = {}) {
	return spawn(jiti, [opsMain, ...args], { stdio: ["ignore", "pipe", "pipe"], ...options });
}

/** A temporary Git repository that reads no developer-global config. */
export function repository() {
	const cwd = scratch("ops-repo-");
	const env = {
		...process.env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_COUNT: "0",
	};
	const git = (...args: string[]) =>
		execFileSync(
			"git",
			[
				"-c",
				"user.name=t",
				"-c",
				"user.email=t@example.com",
				"-c",
				"commit.gpgsign=false",
				...args,
			],
			{ cwd, env, encoding: "utf8" },
		).trim();
	git("init", "--quiet");
	writeFileSync(join(cwd, "a.txt"), "one\n");
	git("add", "a.txt");
	git("commit", "--quiet", "-m", "one");
	return { cwd, git, head: () => git("rev-parse", "HEAD") };
}

/** Writes an executable Node script. */
export function executable(path: string, source: string) {
	writeFileSync(path, `#!${process.execPath}\n${source}`, { mode: 0o755 });
}
