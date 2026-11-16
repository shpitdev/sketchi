// `pnpm ci:local`: the local CI gate. It runs the checks remote CI does not and, when they pass,
// posts a `local-ci` commit status on the exact PR head it checked. `--no-signoff` runs the same
// checks without the status, optionally against a previously verified unit base with `--base`.
// tools/ops/ci-local.mjs installs frozen dependencies first, then runs this.
import { hostname } from "node:os";

import { Clock, Config, Console, Effect, FileSystem, Option, Path, Schema } from "effect";

import { optionalEnv } from "../outputs";
import { capture, opsError, output, runToLog, type RunOptions } from "../process";
import { acquireSlot } from "./slots";

export const DEFAULT_BASE = "origin/main";
const STATUS_CONTEXT = "local-ci";
// oxlint-disable-next-line no-control-regex -- strips colour codes from logged output
const ANSI = /\x1b\[[0-9;]*m/g;

/** A failed check, already reported with its log tail. */
export class GateFailed extends Schema.TaggedError<GateFailed, { readonly brand: unique symbol }>()(
	"GateFailed",
	{},
) {}

export const HELP = `Installs frozen dependencies, checks Nx reference sync, and runs native Nx affected checks:
lint/format, scenario CLI smoke, deployment/process and domain/font tests, typecheck/build/test,
root TypeScript references and the editor Storybook. Full origin/main and --all gates also run
sampled routing; unit gates select routing from its native target inputs.
Changes include committed, staged, unstaged and untracked files. Logs go to .memory/ci-local/.
Nx reuses its native local task cache across worktrees. For caller-selected fuzz diagnostic
outputs, run the Nx target with --skip-nx-cache.

On success it posts a "${STATUS_CONTEXT}" commit status on the pushed PR head. --no-signoff runs
the checks only and works on a dirty or unpushed worktree. --all runs every project and sampled
routing instead of the Nx-affected graph. --base compares with another Git commit/ref: unit checks
against a previously fully gated staging head require --no-signoff, and readiness and signoff
require the full gate against origin/main.

At most CI_LOCAL_SLOTS (default 2) gates run at once on this machine.`;

export interface GateOptions {
	readonly signoff: boolean;
	readonly all: boolean;
	readonly base: Option.Option<string>;
}

export function formatDuration(ms: number) {
	const seconds = Math.round(ms / 1000);
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

const git = (cwd: string, args: readonly string[]) =>
	output("git", args, { cwd }).pipe(Effect.map((text) => text.trim()));

const PullRequest = Schema.Struct({
	number: Schema.Number,
	headRefOid: Schema.String,
	state: Schema.String,
});
type PullRequest = typeof PullRequest.Type;

/** This branch's open PR, or none. */
const readPullRequest = Effect.fn("ops.ciLocal.readPullRequest")(function* (cwd: string) {
	const result = yield* capture("gh", ["pr", "view", "--json", "number,headRefOid,state"], {
		cwd,
	}).pipe(Effect.mapError((error) => opsError(`gh pr view failed: ${error.message}`)));
	if (result.code !== 0) {
		if (/no pull requests found/i.test(result.stderr)) return Option.none<PullRequest>();
		return yield* opsError(`gh pr view failed: ${result.stderr.trim() || `exit ${result.code}`}`);
	}
	const pr = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PullRequest))(
		result.stdout,
	).pipe(
		Effect.mapError(() => opsError(`gh pr view returned an unexpected answer: ${result.stdout}`)),
	);
	return pr.state === "OPEN" ? Option.some(pr) : Option.none<PullRequest>();
});

/** The HEAD to sign off, after refusing a dirty worktree or a HEAD the open PR does not have. */
const assertSignoffReady = Effect.fn("ops.ciLocal.assertSignoffReady")(function* (
	cwd: string,
	pr: Option.Option<PullRequest>,
) {
	const dirty = yield* git(cwd, ["status", "--porcelain"]);
	if (dirty) {
		return yield* opsError(
			`The worktree has uncommitted changes; commit them or pass --no-signoff.\n${dirty}`,
		);
	}
	if (Option.isNone(pr)) {
		return yield* opsError("This branch has no open PR; submit it first, or pass --no-signoff.");
	}
	const head = yield* git(cwd, ["rev-parse", "HEAD"]);
	if (pr.value.headRefOid !== head) {
		return yield* opsError(
			`HEAD ${head.slice(0, 12)} is not the head of PR #${pr.value.number} (${pr.value.headRefOid.slice(0, 12)}); push it first, or pass --no-signoff.`,
		);
	}
	return { head, number: pr.value.number };
});

const printLogTail = Effect.fn("ops.ciLocal.printLogTail")(function* (log: string, lines = 80) {
	const fs = yield* FileSystem.FileSystem;
	const text = yield* fs.readFileString(log).pipe(Effect.option);
	if (Option.isNone(text)) return;
	yield* Console.error(`\n--- last ${lines} lines of ${log} ---`);
	yield* Console.error(text.value.replace(ANSI, "").trimEnd().split("\n").slice(-lines).join("\n"));
});

const targetNames = Effect.fn("ops.ciLocal.targetNames")(function* (file: string) {
	const fs = yield* FileSystem.FileSystem;
	const config = yield* fs.readFileString(file).pipe(
		Effect.flatMap(
			Schema.decodeUnknownEffect(
				Schema.fromJsonString(
					Schema.Struct({ targets: Schema.Record(Schema.String, Schema.Unknown) }),
				),
			),
		),
		Effect.mapError(() => opsError(`Cannot read the targets of ${file}.`)),
	);
	return Object.keys(config.targets);
});

export const runGate = Effect.fn("ops.ciLocal.gate")(function* (options: GateOptions) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const now = Clock.currentTimeMillis;
	// The bootstrap passes when it started and how long the frozen install took.
	const bootstrapStart = yield* optionalEnv("CI_LOCAL_STARTED_AT");
	const installMs = yield* optionalEnv("CI_LOCAL_INSTALL_MS");
	const started =
		Option.match(bootstrapStart, { onNone: () => undefined, onSome: Number }) ?? (yield* now);
	const report: string[] = Option.isSome(installMs)
		? [`✓ pnpm install in ${formatDuration(Number(installMs.value))}`]
		: [];

	const base = Option.getOrElse(options.base, () => DEFAULT_BASE);
	const cwd = yield* git(process.cwd(), ["rev-parse", "--show-toplevel"]);
	yield* git(cwd, ["fetch", "--quiet", "origin", "main"]).pipe(
		Effect.catch(() => Console.warn(`Could not fetch origin main; using the local ${base} ref.`)),
	);
	const baseCommit = yield* git(cwd, [
		"rev-parse",
		"--verify",
		"--end-of-options",
		`${base}^{commit}`,
	]);
	const full =
		baseCommit === (yield* git(cwd, ["rev-parse", "--verify", `${DEFAULT_BASE}^{commit}`]));
	if (options.signoff && !full) {
		return yield* opsError(
			"Signoff requires the full gate against origin/main; use --no-signoff for a unit base.",
		);
	}
	const signedHead = options.signoff
		? Option.some(yield* assertSignoffReady(cwd, yield* readPullRequest(cwd)))
		: Option.none();
	yield* Console.log(`Comparing against ${base} (${baseCommit}), including working-tree changes.`);

	const slots = yield* Config.Int("CI_LOCAL_SLOTS").pipe(
		Config.withDefault(2),
		Effect.map((value) => (value > 0 ? value : 2)),
		Effect.orElseSucceed(() => 2),
	);
	const cacheHome = yield* optionalEnv("XDG_CACHE_HOME");
	const home = yield* optionalEnv("HOME");
	const cacheRoot = path.join(
		Option.getOrElse(cacheHome, () =>
			path.join(
				Option.getOrElse(home, () => "/tmp"),
				".cache",
			),
		),
		"sketchi",
		"ci-local",
	);
	let lastWaitNotice = 0;
	yield* acquireSlot({
		dir: path.join(cacheRoot, "slots"),
		slots,
		onWait: (holders) =>
			Effect.gen(function* () {
				const time = yield* now;
				if (time - lastWaitNotice < 60_000) return;
				lastWaitNotice = time;
				const running = holders
					.map(
						(holder) => `${path.basename(holder.cwd)} (${formatDuration(time - holder.startedAt)})`,
					)
					.join(", ");
				yield* Console.log(`Waiting for a local CI slot (all ${slots} in use: ${running})`);
			}),
	});

	const mergeBase = yield* git(cwd, ["merge-base", baseCommit, "HEAD"]);
	const runOptions: RunOptions = {
		cwd,
		env: {
			// What GitHub Actions sets; Vitest and the fuzz samples read it.
			CI: "true",
			NX_DAEMON: "false",
			NX_NO_CLOUD: "true",
			NX_SKIP_REMOTE_CACHE: "true",
			NX_TUI: "false",
			// Without NX_HEAD, Nx compares the merge base with the working tree, so uncommitted and
			// untracked changes count.
			NX_BASE: undefined,
			NX_HEAD: undefined,
		},
	};
	const logDir = path.join(cwd, ".memory", "ci-local");
	yield* fs.makeDirectory(logDir, { recursive: true }).pipe(Effect.orDie);
	const logFile = (name: string) => path.join(logDir, `${name}.log`);

	// Nx 24 expands wildcards in dependsOn, but not in CLI -t. Derive names from the owning
	// configuration: an aggregate dependency would force every family to run.
	const targets = [
		"typecheck",
		"build",
		"test",
		"check-scenario",
		"check-storybook",
		...(yield* targetNames(path.join(cwd, "packages/diagrams/project.json"))).filter((name) =>
			name.startsWith("test-"),
		),
		...(yield* targetNames(path.join(cwd, "tools/ops/project.json"))).filter((name) =>
			name.startsWith("check-"),
		),
		...(!full && !options.all ? ["routing-sample"] : []),
	];
	const nxScope = options.all ? ["run-many"] : ["affected", `--base=${mergeBase}`];
	const steps: Array<readonly [label: string, log: string, args: readonly string[]]> = [
		["TypeScript reference sync", "sync", ["nx", "sync:check"]],
		[
			"native Nx checks",
			"nx",
			["nx", ...nxScope, "-t", targets.join(","), "--parallel=4", "--outputStyle=static"],
		],
	];
	if (full || options.all) {
		steps.push([
			"sampled routing",
			"routing-sample",
			["nx", "run", "diagrams:routing-sample", "--outputStyle=static"],
		]);
	}

	for (const [label, log, args] of steps) {
		yield* Console.log(`→ ${label}`);
		const stepStarted = yield* now;
		const code = yield* runToLog("pnpm", args, logFile(log), runOptions).pipe(
			Effect.mapError((error) => opsError(`${label}: ${String(error)}`)),
		);
		if (code !== 0) {
			yield* printLogTail(logFile(log));
			report.push(`✖ ${label}`);
			yield* Console.log(
				`\nlocal-ci: failed after ${formatDuration((yield* now) - started)}\n${report.join("\n")}`,
			);
			return yield* new GateFailed();
		}
		report.push(`✓ ${label} in ${formatDuration((yield* now) - stepStarted)}`);
	}

	const duration = formatDuration((yield* now) - started);
	yield* Console.log(`\nlocal-ci: passed in ${duration}\n${report.join("\n")}`);
	if (Option.isNone(signedHead)) return;

	const after = yield* assertSignoffReady(cwd, yield* readPullRequest(cwd));
	if (after.head !== signedHead.value.head) {
		return yield* opsError("HEAD moved while the gate ran; rerun pnpm ci:local.");
	}
	yield* output(
		"gh",
		[
			"api",
			"--method",
			"POST",
			`repos/{owner}/{repo}/statuses/${after.head}`,
			"-f",
			"state=success",
			"-f",
			`context=${STATUS_CONTEXT}`,
			"-f",
			`description=Passed in ${duration} on ${hostname()}${options.all ? " (all projects)" : ""}`.slice(
				0,
				140,
			),
		],
		{ cwd },
	);
	yield* Console.log(
		`Signed off ${after.head.slice(0, 12)} as ${STATUS_CONTEXT} on PR #${after.number}.`,
	);
});
