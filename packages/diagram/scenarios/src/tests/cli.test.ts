// The scenario CLI as Frontierclimb calls it: `--list` for cases, `--scenario <id> --input <file>`
// for a JSON grade on stdout, exit 0 or 1 for a grade and anything else for a crash.
import { assert, describe, it } from "@effect/vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Cause, Effect, Exit, Fiber, Schema } from "effect";
import { vi } from "vitest";

import { runScenarioCli, ScenarioCliUsageError, scenarioCliExitCode } from "../cli.js";
import {
	requireSuccessfulToolProcess,
	runToolProcess,
	ToolProcessSpawnerLive,
} from "../internal/tool-process.js";
import { diagramScenarios } from "../lib/diagram-scenarios.js";
import { scenarioFlowchartDocument } from "../lib/flowchart-document.js";
import { getFlowchartScenario } from "../lib/scenarios.js";

const Report = Schema.fromJsonString(
	Schema.Struct({
		ok: Schema.Boolean,
		error: Schema.optionalKey(Schema.String),
		checks: Schema.Array(
			Schema.Struct({
				id: Schema.String,
				passed: Schema.Boolean,
				message: Schema.optionalKey(Schema.String),
			}),
		),
		metrics: Schema.optionalKey(
			Schema.Record(Schema.String, Schema.Union([Schema.Number, Schema.String])),
		),
	}),
);
const Listing = Schema.fromJsonString(
	Schema.Array(Schema.Struct({ id: Schema.String, prompt: Schema.String })),
);

/** Run the CLI in process and return what it printed and the exit code it set. */
function cli(argv: readonly string[]) {
	return Effect.gen(function* () {
		const previousExitCode = process.exitCode;
		process.exitCode = undefined;
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const exit = yield* Effect.exit(
			runScenarioCli(argv).pipe(Effect.provide(ToolProcessSpawnerLive)),
		);
		const stdout = log.mock.calls.map((call) => String(call[0])).join("\n");
		const exitCode = Exit.isFailure(exit)
			? scenarioCliExitCode(Cause.squash(exit.cause) as { _tag?: string })
			: (process.exitCode ?? 0);
		log.mockRestore();
		process.exitCode = previousExitCode;
		return { exit, stdout, exitCode };
	});
}

const workDir = Effect.acquireRelease(
	Effect.tryPromise(async () => {
		await mkdir(".memory", { recursive: true });
		return mkdtemp(path.join(".memory", "scenario-cli-"));
	}),
	(directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
);

/** Grade one saved input as Frontierclimb does: write it, run `--input`, decode stdout. */
function grade(scenarioId: string, input: unknown) {
	return Effect.scoped(
		Effect.gen(function* () {
			const inputPath = path.join(yield* workDir, "input.json");
			yield* Effect.promise(() =>
				writeFile(inputPath, typeof input === "string" ? input : JSON.stringify(input)),
			);
			const { stdout, exitCode } = yield* cli(["--scenario", scenarioId, "--input", inputPath]);
			const report = yield* Schema.decodeUnknownEffect(Report)(stdout);
			// Frontierclimb treats an error field or a disagreeing exit code as a crash.
			assert.isUndefined(report.error);
			assert.strictEqual(exitCode, report.ok ? 0 : 1);
			return report;
		}),
	);
}

const fixture = (name: string) =>
	Effect.promise(() => readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")).pipe(
		Effect.map((text) => JSON.parse(text) as { ok: boolean; result: Record<string, unknown> }),
	);

const failing = (report: { checks: readonly { id: string; passed: boolean }[] }) =>
	report.checks.filter((check) => !check.passed).map((check) => check.id);

const onboarding = getFlowchartScenario("sketchi-onboarding-decision-flow");

/** The response a generation model gives: a flowchart document in a titled envelope. */
function envelope(diagram = onboarding.expectedDiagram) {
	const { title, ...document } = scenarioFlowchartDocument(diagram);
	return JSON.stringify({ title, diagram: { type: "flowchart", ...document } });
}

describe("scenario CLI", () => {
	it.effect("lists every scenario with its exact prompt", () =>
		Effect.gen(function* () {
			const { stdout, exitCode } = yield* cli(["--list"]);
			assert.strictEqual(exitCode, 0);
			assert.deepStrictEqual(
				yield* Schema.decodeUnknownEffect(Listing)(stdout),
				diagramScenarios.map(({ id, prompt }) => ({ id, prompt })),
			);
		}),
	);

	const shapes: readonly (readonly [string, string, Effect.Effect<unknown>])[] = [
		["execute structuredContent", "incident-escalation", fixture("flowchart-execute")],
		[
			"a full tool result",
			"incident-escalation",
			Effect.map(fixture("flowchart-execute"), (execute) => ({ structuredContent: execute })),
		],
		[
			"a bare build",
			"incident-escalation",
			Effect.map(fixture("flowchart-execute"), (execute) => execute.result),
		],
		[
			"a summary with build receipts",
			"incident-escalation",
			Effect.map(fixture("flowchart-execute"), (execute) => ({
				structuredContent: {
					ok: true,
					result: { summary: "done" },
					builds: [{ ...execute.result, operation: "buildFlowchart" }],
				},
			})),
		],
		["a sequence execute", "checkout-payment-sequence", fixture("sequence-execute")],
		["bare IR", onboarding.id, Effect.succeed(onboarding.expectedDiagram)],
		["a response envelope", onboarding.id, Effect.succeed(envelope())],
	];

	for (const [shape, scenarioId, input] of shapes)
		it.live(`grades ${shape} to a pass`, () =>
			Effect.gen(function* () {
				const report = yield* grade(scenarioId, yield* input);
				assert.deepStrictEqual(failing(report), []);
				assert.isTrue(report.ok);
			}),
		);

	it.live("grades the returned build's receipt, not a later success or another family", () =>
		Effect.gen(function* () {
			// Captured run csyp: the script returns a summary; its receipt carries the spec.
			const summary = yield* grade(
				"deploy-pipeline-logos",
				yield* fixture("deploy-summary-execute"),
			);
			assert.isTrue(summary.checks.find((check) => check.id === "mcp-build-accepted")?.passed);
			assert.isTrue(summary.checks.find((check) => check.id === "min-node-count")?.passed);

			const { result } = yield* fixture("flowchart-execute");
			const receipt = {
				...result,
				buildId: "returned",
				operation: "buildFlowchart",
				quality: { accepted: false },
			};
			const laterSuccess = yield* grade("incident-escalation", {
				ok: true,
				result: { ok: true, status: "accepted", buildId: "returned" },
				builds: [receipt, { ...receipt, buildId: "later", quality: { accepted: true } }],
			});
			assert.deepStrictEqual(failing(laterSuccess), ["mcp-build-accepted"]);

			const sequence = (yield* fixture("sequence-execute")).result;
			const otherFamily = yield* grade("incident-escalation", {
				...sequence,
				operation: "buildSequenceDiagram",
			});
			assert.deepStrictEqual(failing(otherFamily), ["diagram-type"]);
		}),
	);

	const failures: readonly (readonly [string, unknown, string])[] = [
		[
			"a protocol-level failure",
			{ content: [{ type: "text", text: "Error: Code execution timed out" }], isError: true },
			"Code execution timed out",
		],
		[
			"an execute failure",
			{ ok: false, error: "Code execution timed out", logs: [] },
			"Code execution timed out",
		],
		[
			"an unaccepted build",
			{
				ok: true,
				result: { ok: false, status: "quality_failed", normalizedSpec: onboarding.expectedDiagram },
			},
			"quality_failed",
		],
		["a build without a spec", { ok: true, status: "accepted" }, "normalizedSpec"],
	];

	for (const [name, input, message] of failures)
		it.live(`reports ${name} as a failing check`, () =>
			Effect.gen(function* () {
				const report = yield* grade(onboarding.id, input);
				assert.isFalse(report.ok);
				assert.strictEqual(report.checks.length, 1);
				assert.strictEqual(report.checks[0]?.id, "mcp-build-accepted");
				assert.include(report.checks[0]?.message ?? "", message);
			}),
		);

	const usage: readonly (readonly [string, readonly string[]])[] = [
		["an unknown scenario", ["--scenario", "unknown-scenario", "--fixture"]],
		["an unknown flag", ["--unknown"]],
		[
			"a missing generator variable",
			["--scenario", onboarding.id, "--generator-command-env", "SKETCHI_TEST_UNSET_GENERATOR"],
		],
	];

	for (const [name, argv] of usage)
		it.effect(`exits 2 for ${name}`, () =>
			Effect.gen(function* () {
				delete process.env.SKETCHI_TEST_UNSET_GENERATOR;
				const { exit, exitCode } = yield* cli(argv);
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit))
					assert.instanceOf(Cause.squash(exit.cause), ScenarioCliUsageError);
				assert.strictEqual(exitCode, 2);
			}),
		);

	it.live("scores logos on the model's own diagram, before placement repairs", () =>
		Effect.gen(function* () {
			// Every logo shifted one step down: the shipped diagram repairs placement, the score does not.
			const target = getFlowchartScenario("deploy-pipeline-logos");
			const shifted: Readonly<Record<string, string>> = {
				build: "github",
				tests: "docker",
				passed: "cloudflareworkers",
			};
			const report = yield* grade(
				target.id,
				envelope({
					...target.expectedDiagram,
					nodes: target.expectedDiagram.nodes.map(({ icon: _icon, ...node }) =>
						shifted[node.id] ? { ...node, icon: { slug: shifted[node.id]! } } : node,
					),
				}),
			);
			assert.deepStrictEqual(failing(report), ["icons-on-named-steps"]);
		}),
	);

	it.live("reports the delivered scene's editability metrics", () =>
		Effect.gen(function* () {
			const { stdout } = yield* cli(["--scenario", onboarding.id, "--fixture"]);
			const report = yield* Schema.decodeUnknownEffect(Report)(stdout);
			assert.isTrue(report.ok);
			assert.deepStrictEqual(Object.keys(report.metrics ?? {}).toSorted(), [
				"editBoundRoutes",
				"editDragErrors",
				"editDrags",
				"editEndsInside",
				"editEndsOffEdge",
				"editFirstTouchMoves",
				"editReleasedRoutes",
				"editRouteMoves",
				"editRoutesThroughShape",
				"editStrayRouteMoves",
			]);
			assert.isAbove(Number(report.metrics?.editDrags), 0);
		}),
	);
});

describe("generator command", () => {
	const processExists = (pid: number) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	};
	const poll = <A>(read: () => Promise<A | undefined>, what: string) =>
		Effect.gen(function* () {
			for (let attempt = 0; attempt < 300; attempt += 1) {
				const value = yield* Effect.promise(read);
				if (value !== undefined) return value;
				yield* Effect.sleep(10);
			}
			return yield* Effect.die(new Error(`Timed out waiting for ${what}.`));
		});

	it.live.runIf(process.platform !== "win32")(
		"kills the generator and its descendants at the timeout, as a typed exit error",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const pidFile = path.join(yield* workDir, "descendant.pid");
					// A shell, a parent and a child, both ignoring SIGTERM.
					const child = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
					const parent = [
						"const { spawn } = require('node:child_process');",
						`const child = spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore' });`,
						`require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
						child,
					].join("");
					const spec = {
						args: [],
						command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(parent)}`,
						env: process.env,
						shell: true,
					} as const;
					const running = yield* runToolProcess(spec, {
						closeGraceMs: 25,
						forceSettleGraceMs: 250,
						hardKillGraceMs: 150,
						timeoutMs: 500,
					}).pipe(Effect.provide(ToolProcessSpawnerLive), Effect.forkChild);
					const descendant = yield* poll(
						() =>
							readFile(pidFile, "utf8").then(
								(text) => Number(text) || undefined,
								() => undefined,
							),
						"the descendant pid",
					);
					const result = yield* Fiber.join(running);
					assert.isTrue(result.timedOut);
					yield* poll(
						async () => (processExists(descendant) ? undefined : true),
						"the descendant to exit",
					);

					const exit = yield* Effect.exit(requireSuccessfulToolProcess(spec, result));
					assert.isTrue(Exit.isFailure(exit));
					if (Exit.isFailure(exit)) {
						const error = Cause.squash(exit.cause) as { _tag?: string; message?: string };
						assert.strictEqual(error._tag, "ToolProcessExitError");
						assert.include(error.message ?? "", "timed out");
					}
				}),
			),
		60_000,
	);
});
