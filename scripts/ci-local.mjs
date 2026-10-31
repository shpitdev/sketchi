#!/usr/bin/env node
// `pnpm ci:local`: the local CI gate. It runs the checks remote CI does not and, when they pass,
// posts a `local-ci` commit status on the exact PR head it checked. `--no-signoff` runs the same
// checks without the status.
import { execFileSync, spawn } from "node:child_process";
import {
	closeSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { ciScope } from "./ci-scope.mjs";

const BASE = "origin/main";
const STATUS_CONTEXT = "local-ci";
const SQLITE_BUSY = 5;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const VITEST_TIMEOUT = /^(?:Error: )?(?:Test|Hook) timed out in \d+ms/;

/** Each `> nx run <task>` block of Nx's static output, keyed by task. */
export function nxTaskOutputs(log) {
	const outputs = new Map();
	let task;
	for (const line of log.replace(ANSI, "").split("\n")) {
		const header = /^> nx run (\S+)/.exec(line);
		if (header) {
			task = header[1];
			outputs.set(task, "");
		} else if (task) {
			outputs.set(task, `${outputs.get(task)}${line}\n`);
		}
	}
	return outputs;
}

/** The tasks Nx lists under "Failed tasks:". */
export function nxFailedTasks(log) {
	const lines = log.replace(ANSI, "").split("\n");
	const start = lines.findIndex((line) => line.trim() === "Failed tasks:");
	if (start === -1) return [];
	const failed = [];
	for (const line of lines.slice(start + 1)) {
		const item = /^\s*-\s+(\S+)/.exec(line);
		if (item) failed.push(item[1]);
		else if (line.trim() && failed.length > 0) break;
	}
	return failed;
}

/** Whether a Vitest run failed only because tests or hooks hit their timeout. */
export function onlyVitestTimeouts(output) {
	const lines = output.split("\n");
	if (lines.some((line) => /Unhandled Errors?/.test(line))) return false;
	const errors = [];
	lines.forEach((line, index) => {
		if (!/^\s*FAIL\s+\S/.test(line)) return;
		errors.push(
			lines
				.slice(index + 1)
				.find((next) => next.trim())
				?.trim() ?? "",
		);
	});
	return errors.length > 0 && errors.every((error) => VITEST_TIMEOUT.test(error));
}

/**
 * Runs the test targets. When every failed task failed only on Vitest timeouts, each is rerun
 * once on its own; any other failure fails without a rerun.
 */
export async function runTests({ runAll, runTask }) {
	const first = await runAll();
	if (first.code === 0) return { ok: true, reruns: [], logs: [] };
	const failed = nxFailedTasks(first.output);
	const outputs = nxTaskOutputs(first.output);
	const onlyTimeouts =
		failed.length > 0 &&
		failed.every((task) => task.endsWith(":test") && onlyVitestTimeouts(outputs.get(task) ?? ""));
	if (!onlyTimeouts) return { ok: false, reruns: [], logs: [first.log] };
	const reruns = [];
	for (const task of failed) {
		const rerun = await runTask(task);
		reruns.push({ task, passed: rerun.code === 0 });
		if (rerun.code !== 0) return { ok: false, reruns, logs: [rerun.log] };
	}
	return { ok: true, reruns, logs: [] };
}

function readSlotOwner(info) {
	try {
		return JSON.parse(readFileSync(info, "utf8"));
	} catch {
		return;
	}
}

/**
 * Takes one of `slots` machine-wide gate slots under `dir`, waiting while all are held. A slot is
 * an exclusive SQLite transaction on `slot-<n>.db`: SQLite holds it with an fcntl lock, which the
 * kernel drops when the gate exits or is killed, so a dead gate never holds a slot and no gate
 * ever frees another's. `slot-<n>.json` names the holder, for the wait notice only. Resolves to a
 * function that releases the slot.
 */
export async function acquireSlot({ dir, slots, pollMs = 5000, onWait = () => {} }) {
	mkdirSync(dir, { recursive: true });
	const owner = { pid: process.pid, cwd: process.cwd() };
	for (;;) {
		const holders = [];
		for (let index = 0; index < slots; index++) {
			const info = path.join(dir, `slot-${index}.json`);
			const db = new DatabaseSync(path.join(dir, `slot-${index}.db`), { timeout: 0 });
			try {
				db.exec("BEGIN EXCLUSIVE");
			} catch (error) {
				db.close();
				if (error.errcode !== SQLITE_BUSY) throw error;
				holders.push(readSlotOwner(info) ?? { cwd: "unknown", startedAt: Date.now() });
				continue;
			}
			writeFileSync(info, JSON.stringify({ ...owner, startedAt: Date.now() }));
			let released = false;
			return () => {
				if (released) return;
				released = true;
				// The holder file goes while the slot is still held, so it never names the next one.
				rmSync(info, { force: true });
				db.exec("ROLLBACK");
				db.close();
			};
		}
		onWait(holders);
		await sleep(pollMs);
	}
}

function git(cwd, args) {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** The HEAD to sign off, after refusing a dirty worktree or a HEAD the open PR does not have. */
export function assertSignoffReady({ cwd, pr }) {
	const dirty = git(cwd, ["status", "--porcelain"]);
	if (dirty) {
		throw new Error(
			`The worktree has uncommitted changes; commit them or pass --no-signoff.\n${dirty}`,
		);
	}
	if (!pr) throw new Error("This branch has no open PR; submit it first, or pass --no-signoff.");
	const head = git(cwd, ["rev-parse", "HEAD"]);
	if (pr.headRefOid !== head) {
		throw new Error(
			`HEAD ${head.slice(0, 12)} is not the head of PR #${pr.number} (${pr.headRefOid.slice(0, 12)}); push it first, or pass --no-signoff.`,
		);
	}
	return head;
}

function readPullRequest(cwd) {
	try {
		const pr = JSON.parse(
			execFileSync("gh", ["pr", "view", "--json", "number,headRefOid,state"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}),
		);
		if (pr.state === "OPEN") return pr;
	} catch (error) {
		if (/no pull requests found/i.test(String(error.stderr))) return;
		throw new Error(`gh pr view failed: ${String(error.stderr).trim() || error.message}`);
	}
}

// Each child gets its own process group, so an interrupted gate can stop everything it started.
const children = new Set();

function runner(cwd, env) {
	return (command, args, logFile) =>
		new Promise((resolve) => {
			const fd = openSync(logFile, "w");
			const child = spawn(command, args, {
				cwd,
				env,
				stdio: ["ignore", fd, fd],
				detached: true,
			});
			children.add(child);
			let done = false;
			const finish = (code, error) => {
				if (done) return;
				done = true;
				children.delete(child);
				if (error) writeSync(fd, `${error.message}\n`);
				closeSync(fd);
				resolve({ code, log: logFile });
			};
			child.on("error", (error) => finish(127, error));
			child.on("close", (code) => finish(code ?? 1));
		});
}

function formatDuration(ms) {
	const seconds = Math.round(ms / 1000);
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

function printLogTail(log, lines = 80) {
	let text;
	try {
		text = readFileSync(log, "utf8").replace(ANSI, "").trimEnd();
	} catch {
		return;
	}
	console.error(`\n--- last ${lines} lines of ${log} ---`);
	console.error(text.split("\n").slice(-lines).join("\n"));
}

const HELP = `Usage: pnpm ci:local [--no-signoff] [--all]

Runs actionlint when workflows changed, a frozen install, lint/format/custom-rule checks, the
scenario CLI smoke, the deploy and tooling contracts, the Nx-affected typecheck, build and test
targets, the root TypeScript project references, and the diagram UI Storybook build when
diagram-ui is affected. Changes are compared with origin/main, including uncommitted ones. Logs
go to .memory/ci-local/.

On success it posts a "${STATUS_CONTEXT}" commit status on the pushed PR head.

  --no-signoff  Run the checks only. Works on a dirty or unpushed worktree.
  --all         Run every project instead of the Nx-affected graph.

At most CI_LOCAL_SLOTS (default 2) gates run at once on this machine. A test task that failed
only on Vitest timeouts is rerun once on its own before the gate fails.`;

// A failed check, already reported. Exiting through exitCode instead of process.exit lets a piped
// stdout flush the report first.
class GateFailure extends Error {}

async function main(argv) {
	const flags = ["--no-signoff", "--all", "--help", "-h"];
	const unknown = argv.filter((arg) => !flags.includes(arg));
	if (unknown.length > 0 || argv.includes("--help") || argv.includes("-h")) {
		console.log(HELP);
		if (unknown.length > 0) throw new GateFailure();
		return;
	}
	const signoff = !argv.includes("--no-signoff");
	const all = argv.includes("--all");
	const cwd = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
	const started = Date.now();
	let pr = signoff ? readPullRequest(cwd) : undefined;
	const head = signoff ? assertSignoffReady({ cwd, pr }) : undefined;

	try {
		git(cwd, ["fetch", "--quiet", "origin", "main"]);
	} catch {
		console.warn(`Could not fetch origin main; comparing against the local ${BASE}.`);
	}

	const slots = Number(process.env.CI_LOCAL_SLOTS) || 2;
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		process.once(signal, () => {
			for (const child of children) {
				try {
					process.kill(-child.pid, "SIGTERM");
				} catch {}
			}
			process.exit(128 + os.constants.signals[signal]);
		});
	}
	let lastWaitNotice = 0;
	const cacheRoot = path.join(
		process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
		"sketchi",
		"ci-local",
	);
	const release = await acquireSlot({
		dir: path.join(cacheRoot, "slots"),
		slots,
		onWait: (holders) => {
			if (Date.now() - lastWaitNotice < 60_000) return;
			lastWaitNotice = Date.now();
			const running = holders
				.map((h) => `${path.basename(h.cwd)} (${formatDuration(Date.now() - h.startedAt)})`)
				.join(", ");
			console.log(`Waiting for a local CI slot (all ${slots} in use: ${running})`);
		},
	});
	process.on("exit", release);

	const mergeBase = git(cwd, ["merge-base", BASE, "HEAD"]);
	const env = {
		...process.env,
		// What GitHub Actions sets; Vitest and the fuzz samples read it.
		CI: "true",
		NX_DAEMON: "false",
		NX_NO_CLOUD: "true",
		NX_SKIP_REMOTE_CACHE: "true",
		NX_TUI: "false",
	};
	// Without NX_HEAD, Nx compares the merge base with the working tree, so uncommitted and
	// untracked changes count.
	delete env.NX_BASE;
	delete env.NX_HEAD;
	const run = runner(cwd, env);
	const logDir = path.join(cwd, ".memory", "ci-local");
	rmSync(logDir, { recursive: true, force: true });
	mkdirSync(logDir, { recursive: true });
	const logFile = (name) => path.join(logDir, `${name}.log`);

	const report = [];
	const fail = (line, logs = []) => {
		for (const log of logs) printLogTail(log);
		report.push(`✖ ${line}`);
		console.log(
			`\nlocal-ci: failed after ${formatDuration(Date.now() - started)}\n${report.join("\n")}`,
		);
		throw new GateFailure();
	};

	const changed = [
		...git(cwd, ["diff", "--name-only", mergeBase]).split("\n"),
		...git(cwd, ["ls-files", "--others", "--exclude-standard"]).split("\n"),
	].filter(Boolean);
	const workflowsChanged = changed.some((file) => file.startsWith(".github/"));
	const nxScope = all ? ["run-many"] : ["affected", `--base=${mergeBase}`];

	const command =
		(name, ...commands) =>
		async () => {
			const logs = [];
			for (const [index, args] of commands.entries()) {
				const result = await run(args[0], args.slice(1), logFile(`${name}-${index}`));
				logs.push(result.log);
				if (result.code !== 0) return { ok: false, logs: [result.log] };
			}
			return { ok: true, logs };
		};

	// Scoped after the install, which `nx show projects` needs.
	let scope;
	const resolveScope = async () => {
		const projects = all
			? []
			: JSON.parse(
					execFileSync(
						"pnpm",
						["--silent", "nx", "show", "projects", "--affected", `--base=${mergeBase}`, "--json"],
						{ cwd, encoding: "utf8", env },
					),
				);
		scope = ciScope({ all, projects, changedFiles: changed });
		return {
			ok: true,
			label: `scope: ${all ? "all projects" : projects.join(", ") || "no affected projects"}`,
		};
	};

	const tests = async () => {
		const result = await runTests({
			runAll: async () => {
				const first = await run(
					"pnpm",
					["nx", ...nxScope, "-t", "test", "--parallel=4", "--outputStyle=static"],
					logFile("test"),
				);
				return { ...first, output: readFileSync(first.log, "utf8") };
			},
			runTask: (task) =>
				run(
					"pnpm",
					["nx", "run", task, "--outputStyle=static"],
					logFile(`test-rerun-${task.replace(/[^\w-]/g, "_")}`),
				),
		});
		const notes = result.reruns.map(
			({ task, passed }) =>
				`    ↻ ${task} timed out under load; ${passed ? "passed" : "failed again"} when rerun alone`,
		);
		return { ok: result.ok, logs: result.logs, notes };
	};

	const conditional = (enabled, skip, step) => async () =>
		enabled() ? step() : { skip: `${skip}: not affected` };

	const steps = [
		workflowsChanged && ["actionlint", command("actionlint", ["actionlint"])],
		[
			"pnpm install",
			command("pnpm-install", ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"]),
		],
		["affected scope", resolveScope],
		["lint, format, and custom-rule checks", command("check", ["pnpm", "run", "check"])],
		// `pnpm run check` already built every package, including the scenarios CLI.
		[
			"scenario CLI smoke under plain Node",
			command(
				"scenario-cli",
				["node", "packages/diagram/scenarios/dist/cli.js", "--list"],
				[
					"node",
					"packages/diagram/scenarios/dist/cli.js",
					"--scenario",
					"sketchi-onboarding-decision-flow",
					"--fixture",
				],
			),
		],
		[
			"deploy, onboarding, and cutover contracts",
			command("deploy-scripts", ["pnpm", "run", "test:deploy-scripts"]),
		],
		[
			"repository tooling contracts",
			command(
				"tools",
				["pnpm", "exec", "tsc", "-p", "tools/tsconfig.json", "--noEmit"],
				[
					"pnpm",
					"exec",
					"vitest",
					"run",
					"--config",
					"tools/vitest.config.mts",
					"--exclude",
					"tools/project-graph.test.ts",
				],
			),
		],
		[
			"typecheck and build",
			command("typecheck-build", [
				"pnpm",
				"nx",
				...nxScope,
				"-t",
				"typecheck,typecheck-native,build",
				"--outputStyle=static",
			]),
		],
		["tests", tests],
		[
			"root TypeScript project references and project graph",
			conditional(
				() => scope.code,
				"root project references and project graph",
				command(
					"graph",
					["pnpm", "exec", "tsc6", "-b", "--pretty", "false"],
					[
						"pnpm",
						"exec",
						"vitest",
						"run",
						"--config",
						"tools/vitest.config.mts",
						"tools/project-graph.test.ts",
					],
				),
			),
		],
		[
			"diagram UI Storybook build",
			conditional(
				() => scope.storybook,
				"diagram UI Storybook",
				command("storybook", ["pnpm", "nx", "build-storybook", "diagram-ui"]),
			),
		],
	].filter(Boolean);

	for (const [label, step] of steps) {
		console.log(`→ ${label}`);
		const stepStarted = Date.now();
		const result = await step();
		if (result.skip) {
			report.push(`- ${result.skip}`);
			continue;
		}
		const line = [result.label ?? label, ...(result.notes ?? [])].join("\n");
		if (!result.ok) fail(line, result.logs);
		report.push(
			`✓ ${result.label ?? label} in ${formatDuration(Date.now() - stepStarted)}`,
			...(result.notes ?? []),
		);
	}

	const duration = formatDuration(Date.now() - started);
	console.log(`\nlocal-ci: passed in ${duration}\n${report.join("\n")}`);
	if (!signoff) return;

	pr = readPullRequest(cwd);
	if (assertSignoffReady({ cwd, pr }) !== head) {
		throw new Error("HEAD moved while the gate ran; rerun pnpm ci:local.");
	}
	const notes = [
		all && "all projects",
		report.some((line) => line.includes("↻")) && "after a timeout rerun",
	].filter(Boolean);
	execFileSync(
		"gh",
		[
			"api",
			"--method",
			"POST",
			`repos/{owner}/{repo}/statuses/${head}`,
			"-f",
			"state=success",
			"-f",
			`context=${STATUS_CONTEXT}`,
			"-f",
			`description=Passed in ${duration} on ${os.hostname()}${notes.length ? ` (${notes.join(", ")})` : ""}`.slice(
				0,
				140,
			),
		],
		{ cwd, stdio: ["ignore", "ignore", "inherit"] },
	);
	console.log(`Signed off ${head.slice(0, 12)} as ${STATUS_CONTEXT} on PR #${pr.number}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	try {
		await main(process.argv.slice(2));
	} catch (error) {
		if (!(error instanceof GateFailure)) console.error(`local-ci: ${error.message}`);
		process.exitCode = 1;
	}
}
