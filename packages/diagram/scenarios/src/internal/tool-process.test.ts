import { assert, describe, it } from "@effect/vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import {
	requireSuccessfulToolProcess,
	runToolProcess,
	type RunningToolProcess,
	ToolProcessSpawner,
	ToolProcessSpawnerLive,
	type ToolProcessTerminal,
} from "./tool-process.js";

const realProcessPolicy = {
	closeGraceMs: 25,
	forceSettleGraceMs: 250,
	hardKillGraceMs: 150,
	timeoutMs: 500,
} as const;

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function waitForPid(pidFile: string): Effect.Effect<number, Error> {
	return Effect.gen(function* () {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const contents = yield* Effect.tryPromise(() => readFile(pidFile, "utf8")).pipe(
				Effect.option,
			);
			if (contents._tag === "Some") {
				const pid = Number.parseInt(contents.value, 10);
				if (Number.isSafeInteger(pid) && pid > 0) return pid;
			}
			yield* Effect.sleep(10);
		}
		return yield* Effect.fail(new Error("Descendant pid was not published."));
	});
}

function waitForProcessExit(pid: number): Effect.Effect<void, Error> {
	return Effect.gen(function* () {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			if (!processExists(pid)) return;
			yield* Effect.sleep(10);
		}
		return yield* Effect.fail(new Error(`Descendant process ${String(pid)} remained alive.`));
	});
}

function descendantProcessSpec(pidFile: string) {
	const descendantScript = [
		"process.on('SIGTERM', () => {});",
		"setInterval(() => {}, 1000);",
	].join("");
	const parentScript = [
		"const { spawn } = require('node:child_process');",
		"const { writeFileSync } = require('node:fs');",
		`const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' });`,
		`writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
		"process.on('SIGTERM', () => {});",
		"setInterval(() => {}, 1000);",
	].join("");
	return {
		args: [],
		command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(parentScript)}`,
		env: process.env,
		shell: true,
	} as const;
}

function withProcessFixture<A, E>(
	use: (input: { readonly pidFile: string }) => Effect.Effect<A, E>,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			yield* Effect.tryPromise(() => mkdir(".memory", { recursive: true }));
			const fixtureDir = yield* Effect.acquireRelease(
				Effect.tryPromise(() => mkdtemp(path.join(".memory", "tool-process-"))),
				(directory) =>
					Effect.tryPromise(() => rm(directory, { recursive: true, force: true })).pipe(
						Effect.ignore,
					),
			);
			return yield* use({ pidFile: path.join(fixtureDir, "descendant.pid") });
		}),
	);
}

const spec = {
	args: ["fixture"],
	command: "test-generator",
	env: {},
	stdin: "prompt",
} as const;

const policy = {
	closeGraceMs: 10,
	forceSettleGraceMs: 30,
	hardKillGraceMs: 20,
	timeoutMs: 100,
} as const;

interface FakeProcessState {
	readonly released: { count: number };
	readonly signals: NodeJS.Signals[];
}

function makeFakeProcessLayer(options: {
	readonly settleOnSignal?: NodeJS.Signals;
	readonly terminal?: ToolProcessTerminal;
}) {
	return Effect.gen(function* () {
		const exit = yield* Deferred.make<ToolProcessTerminal>();
		const close = yield* Deferred.make<ToolProcessTerminal>();
		const state: FakeProcessState = {
			released: { count: 0 },
			signals: [],
		};
		const process: RunningToolProcess = {
			awaitClose: Deferred.await(close),
			awaitExit: Deferred.await(exit),
			kill: (signal) =>
				Effect.gen(function* () {
					state.signals.push(signal);
					if (options.settleOnSignal === signal) {
						const terminal = options.terminal ?? {
							exitCode: null,
							signal,
						};
						yield* Deferred.succeed(exit, terminal);
						yield* Deferred.succeed(close, terminal);
					}
					return true;
				}),
			output: Effect.succeed({ stderr: "stderr", stdout: "stdout" }),
		};
		const layer = Layer.succeed(ToolProcessSpawner, {
			spawn: () =>
				Effect.acquireRelease(Effect.succeed(process), () =>
					Effect.sync(() => {
						state.released.count += 1;
					}),
				),
		});
		return { close, exit, layer, state };
	});
}

describe("runToolProcess", () => {
	for (const ignoresSigterm of [false, true]) {
		it.live(
			`returns timeout metadata for a blocked 2 MiB stdin write after ${ignoresSigterm ? "SIGKILL escalation" : "SIGTERM"}`,
			() =>
				Effect.gen(function* () {
					const result = yield* runToolProcess(
						{
							args: [
								"-e",
								[
									ignoresSigterm ? "process.on('SIGTERM', () => {});" : "",
									"process.stdout.write('READY\\n');",
									"setInterval(() => {}, 1000);",
								].join(""),
							],
							command: process.execPath,
							env: process.env,
							stdin: "x".repeat(2 * 1024 * 1024),
						},
						realProcessPolicy,
					).pipe(Effect.provide(ToolProcessSpawnerLive));
					assert.isTrue(result.timedOut);
					assert.strictEqual(result.exitCode, null);
					assert.strictEqual(result.signal, ignoresSigterm ? "SIGKILL" : "SIGTERM");
					assert.include(result.stdout, "READY");
				}),
		);
	}
	it.live("returns a typed failure when a child exits before reading a large prompt", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				runToolProcess(
					{
						args: ["-e", "process.exit(0)"],
						command: process.execPath,
						env: process.env,
						stdin: "x".repeat(2 * 1024 * 1024),
					},
					realProcessPolicy,
				).pipe(Effect.provide(ToolProcessSpawnerLive)),
			);
			assert.strictEqual(error._tag, "ToolProcessSpawnError");
			assert.include(error.message, "stdin");
		}),
	);

	for (const interrupted of [false, true]) {
		it.live.runIf(process.platform !== "win32")(
			`preserves descendant SIGTERM cleanup grace on ${interrupted ? "interruption" : "timeout"} after leader exit`,
			() =>
				withProcessFixture(({ pidFile }) =>
					Effect.gen(function* () {
						const cleanedFile = `${pidFile}.cleaned`;
						const descendantScript = [
							"const { writeFileSync } = require('node:fs');",
							`process.on('SIGTERM', () => setTimeout(() => { writeFileSync(${JSON.stringify(cleanedFile)}, 'cleaned'); process.exit(0); }, 200));`,
							"process.stdout.write('READY\\n');",
							"setInterval(() => {}, 1000);",
						].join("");
						const parentScript = [
							"const { spawn } = require('node:child_process');",
							"const { writeFileSync } = require('node:fs');",
							`const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: ['ignore', 'pipe', 'inherit'] });`,
							`child.stdout.once('data', () => writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)));`,
							"process.on('SIGTERM', () => process.exit(0));",
							"setInterval(() => {}, 1000);",
						].join("");
						const fiber = yield* runToolProcess(
							{
								args: ["-e", parentScript],
								command: process.execPath,
								env: process.env,
							},
							{
								...realProcessPolicy,
								hardKillGraceMs: 1_000,
								timeoutMs: interrupted ? 10_000 : 500,
							},
						).pipe(Effect.provide(ToolProcessSpawnerLive), Effect.forkChild);
						yield* waitForPid(pidFile);
						if (interrupted) yield* Fiber.interrupt(fiber);
						else assert.isTrue((yield* Fiber.join(fiber)).timedOut);
						const cleaned = yield* Effect.tryPromise(() => readFile(cleanedFile, "utf8"));
						assert.strictEqual(cleaned, "cleaned");
					}),
				),
		);
	}
	it.effect("returns successful output and releases the scoped process", () =>
		Effect.gen(function* () {
			const harness = yield* makeFakeProcessLayer({});
			yield* Deferred.succeed(harness.exit, { exitCode: 0, signal: null });
			yield* Deferred.succeed(harness.close, { exitCode: 0, signal: null });

			const result = yield* runToolProcess(spec, policy).pipe(Effect.provide(harness.layer));

			assert.deepStrictEqual(result, {
				durationMs: 0,
				exitCode: 0,
				signal: null,
				stderr: "stderr",
				stdout: "stdout",
				timedOut: false,
			});
			assert.strictEqual(harness.state.released.count, 1);
		}),
	);

	it.effect("uses TestClock to escalate SIGTERM to SIGKILL and settle", () =>
		Effect.gen(function* () {
			const harness = yield* makeFakeProcessLayer({});
			const fiber = yield* runToolProcess(spec, policy).pipe(
				Effect.provide(harness.layer),
				Effect.forkChild,
			);
			yield* Effect.yieldNow;

			yield* TestClock.adjust(policy.timeoutMs);
			assert.deepStrictEqual(harness.state.signals, ["SIGTERM"]);
			yield* TestClock.adjust(policy.hardKillGraceMs);
			assert.deepStrictEqual(harness.state.signals, ["SIGTERM", "SIGKILL"]);
			yield* TestClock.adjust(policy.forceSettleGraceMs);

			const result = yield* Fiber.join(fiber);
			assert.isTrue(result.timedOut);
			assert.strictEqual(result.exitCode, null);
			assert.strictEqual(harness.state.released.count, 1);
		}),
	);

	it.effect("settles gracefully after the timeout SIGTERM", () =>
		Effect.gen(function* () {
			const harness = yield* makeFakeProcessLayer({
				settleOnSignal: "SIGTERM",
			});
			const fiber = yield* runToolProcess(spec, policy).pipe(
				Effect.provide(harness.layer),
				Effect.forkChild,
			);
			yield* Effect.yieldNow;
			yield* TestClock.adjust(policy.timeoutMs);

			const result = yield* Fiber.join(fiber);
			assert.deepStrictEqual(harness.state.signals, ["SIGTERM"]);
			assert.strictEqual(result.signal, "SIGTERM");
			assert.isTrue(result.timedOut);
			assert.strictEqual(harness.state.released.count, 1);
		}),
	);

	it.effect("interrupts, terminates, and releases the child scope", () =>
		Effect.gen(function* () {
			const harness = yield* makeFakeProcessLayer({
				settleOnSignal: "SIGTERM",
			});
			const processFiber = yield* runToolProcess(spec, policy).pipe(
				Effect.provide(harness.layer),
				Effect.forkChild,
			);
			yield* Effect.yieldNow;
			yield* Fiber.interrupt(processFiber);
			const exit = yield* Fiber.await(processFiber);

			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				assert.isTrue(Cause.hasInterrupts(exit.cause));
			}
			assert.deepStrictEqual(harness.state.signals, ["SIGTERM"]);
			assert.strictEqual(harness.state.released.count, 1);
		}),
	);

	it.live.runIf(process.platform !== "win32")("terminates shell descendants after a timeout", () =>
		withProcessFixture(({ pidFile }) =>
			Effect.gen(function* () {
				const processFiber = yield* runToolProcess(
					descendantProcessSpec(pidFile),
					realProcessPolicy,
				).pipe(Effect.provide(ToolProcessSpawnerLive), Effect.forkChild);
				const descendantPid = yield* waitForPid(pidFile);
				const result = yield* Fiber.join(processFiber);

				assert.isTrue(result.timedOut);
				yield* waitForProcessExit(descendantPid);
				assert.isFalse(processExists(descendantPid));
			}),
		),
	);

	it.live.runIf(process.platform !== "win32")("terminates shell descendants when interrupted", () =>
		withProcessFixture(({ pidFile }) =>
			Effect.gen(function* () {
				const processFiber = yield* runToolProcess(descendantProcessSpec(pidFile), {
					...realProcessPolicy,
					timeoutMs: 10_000,
				}).pipe(Effect.provide(ToolProcessSpawnerLive), Effect.forkChild);
				const descendantPid = yield* waitForPid(pidFile);
				yield* Fiber.interrupt(processFiber);
				const interrupted = yield* Fiber.await(processFiber);

				assert.isTrue(Exit.isFailure(interrupted));
				if (Exit.isFailure(interrupted)) {
					assert.isTrue(Cause.hasInterrupts(interrupted.cause));
				}
				yield* waitForProcessExit(descendantPid);
				assert.isFalse(processExists(descendantPid));
			}),
		),
	);
});

describe("requireSuccessfulToolProcess", () => {
	it.effect("maps success to stdout", () =>
		requireSuccessfulToolProcess(spec, {
			durationMs: 1,
			exitCode: 0,
			signal: null,
			stderr: "",
			stdout: "scene",
			timedOut: false,
		}).pipe(Effect.map((stdout) => assert.strictEqual(stdout, "scene"))),
	);

	it.effect("maps timeout metadata to a typed exit error", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				requireSuccessfulToolProcess(spec, {
					durationMs: 100,
					exitCode: null,
					signal: "SIGKILL",
					stderr: "forced",
					stdout: "",
					timedOut: true,
				}),
			);
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				const error = Cause.findError(exit.cause);
				assert.strictEqual(error._tag, "Success");
				if (error._tag === "Success") {
					assert.strictEqual(error.success._tag, "ToolProcessExitError");
					assert.include(error.success.message, "timed out");
				}
			}
		}),
	);

	it.effect("maps a non-zero exit and preserves stderr", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				requireSuccessfulToolProcess(spec, {
					durationMs: 5,
					exitCode: 23,
					signal: null,
					stderr: "generator failed",
					stdout: "partial",
					timedOut: false,
				}),
			);
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				const error = Cause.findError(exit.cause);
				assert.strictEqual(error._tag, "Success");
				if (error._tag === "Success") {
					assert.strictEqual(error.success.exitCode, 23);
					assert.strictEqual(error.success.stderr, "generator failed");
					assert.include(error.success.message, "exited with 23");
				}
			}
		}),
	);
});
