#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off -- The standalone gate bootstrap installs dependencies before the Effect runner is available.

// `pnpm ci:local` bootstrap. The gate (tools/ops/src/ci-local/gate.ts) is typed Effect and needs
// the workspace's dependencies, so this installs the frozen lockfile and then replaces itself
// with the gate. Run `pnpm ci:local --help` for the gate's options.
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const started = Date.now();
const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
if (top.status !== 0) {
	console.error(`local-ci: ${top.stderr.trim() || "not inside a Git worktree"}`);
	process.exit(1);
}
const root = top.stdout.trim();
const logDir = path.join(root, ".memory", "ci-local");
rmSync(logDir, { recursive: true, force: true });
mkdirSync(logDir, { recursive: true });

console.log("→ pnpm install");
const log = path.join(logDir, "pnpm-install.log");
const fd = openSync(log, "w");
const install = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
	cwd: root,
	stdio: ["ignore", fd, fd],
});
closeSync(fd);
const installMs = Date.now() - started;
if (install.status !== 0) {
	const tail = readFileSync(log, "utf8").trimEnd().split("\n").slice(-80).join("\n");
	console.error(`\n--- last 80 lines of ${log} ---\n${install.error?.message ?? tail}`);
	console.log(`\nlocal-ci: failed after ${Math.round(installMs / 1000)}s\n✖ pnpm install`);
	process.exit(1);
}

const ops = fileURLToPath(new URL(".", import.meta.url));
const jiti = path.join(ops, "../../node_modules/.bin/jiti");
process.execve(jiti, [jiti, path.join(ops, "src/main.ts"), "ci-local", ...process.argv.slice(2)], {
	...process.env,
	CI_LOCAL_STARTED_AT: String(started),
	CI_LOCAL_INSTALL_MS: String(installMs),
});
