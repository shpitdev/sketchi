import { assert, describe, it } from "@effect/vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Cause, Effect, Exit, Layer, Schema } from "effect";

import { runScenarioCli, ScenarioCliUsageError, scenarioCliExitCode } from "./cli.js";
import { ToolProcessSpawner, ToolProcessSpawnerLive } from "./internal/tool-process.js";
import { getFlowchartScenario } from "./lib/scenarios.js";
import { getSequenceScenario } from "./lib/sequence-scenarios.js";

const scenario = getFlowchartScenario("sketchi-onboarding-decision-flow");
function generatedEnvelope(requirements: readonly unknown[] = []) {
	const { title, ...diagram } = scenario.expectedDiagram;
	return JSON.stringify({
		title,
		intent: {
			requestedKind: "flowchart",
			nativeKind: "flowchart",
			requirements,
		},
		diagram,
	});
}

function withCandidate(
	output: string,
	use: (directory: string) => Effect.Effect<void, unknown, ToolProcessSpawner>,
) {
	const terminal = Effect.succeed({ exitCode: 0, signal: null });
	const layer = Layer.succeed(ToolProcessSpawner, {
		spawn: () =>
			Effect.succeed({
				awaitExit: terminal,
				awaitClose: terminal,
				kill: () => Effect.succeed(false),
				output: Effect.succeed({ stdout: output, stderr: "" }),
			}),
	});
	return Effect.scoped(
		Effect.gen(function* () {
			const previousExitCode = process.exitCode;
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					process.exitCode = previousExitCode;
				}),
			);
			yield* Effect.tryPromise(() => mkdir(".memory", { recursive: true }));
			const directory = yield* Effect.acquireRelease(
				Effect.tryPromise(() => mkdtemp(path.join(".memory", "scenario-cli-"))),
				(value) =>
					Effect.tryPromise(() => rm(value, { recursive: true, force: true })).pipe(Effect.ignore),
			);
			yield* use(directory);
		}),
	).pipe(Effect.provide(layer));
}

const Report = Schema.fromJsonString(
	Schema.Struct({
		ok: Schema.Boolean,
		error: Schema.optionalKey(Schema.String),
		checks: Schema.Array(
			Schema.Struct({
				id: Schema.String,
				message: Schema.optionalKey(Schema.String),
				passed: Schema.Boolean,
			}),
		),
	}),
);

describe("scenario CLI candidate decoding", () => {
	it.live("accepts bare IR emitted by an offline generator command", () =>
		withCandidate("", (directory) =>
			Effect.gen(function* () {
				const generatorPath = path.join(directory, "generator.mjs");
				const reportPath = path.join(directory, "report.json");
				const output = JSON.stringify(scenario.expectedDiagram);
				yield* Effect.tryPromise(() =>
					writeFile(
						generatorPath,
						[
							"process.stdin.resume();",
							`process.stdin.once('end', () => process.stdout.write(${JSON.stringify(output)}));`,
						].join("\n"),
					),
				);
				const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
				yield* runScenarioCli([
					"--scenario",
					scenario.id,
					"--report-out",
					reportPath,
					"--candidate-out-dir",
					directory,
					"--generator-command",
					`${quote(process.execPath)} ${quote(generatorPath)}`,
				]).pipe(Effect.provide(ToolProcessSpawnerLive));
				const report = yield* Schema.decodeUnknownEffect(Report)(
					yield* Effect.tryPromise(() => readFile(reportPath, "utf8")),
				);
				assert.isTrue(report.ok);
				assert.isUndefined(report.error);
				assert.strictEqual(
					yield* Effect.tryPromise(() =>
						readFile(path.join(directory, `${scenario.id}.candidate.txt`), "utf8"),
					),
					output,
				);
			}),
		),
	);

	it.live("scores a sequence response envelope on the model's chronological structure", () => {
		const sequence = getSequenceScenario("checkout-payment-sequence");
		const { title, ...diagram } = sequence.expectedDiagram;
		const [submit, charge, approved, confirmation] = diagram.messages;
		const output = JSON.stringify({
			title,
			intent: { requestedKind: "sequence", nativeKind: "sequence", requirements: [] },
			diagram: { ...diagram, messages: [submit, approved, charge, confirmation] },
		});
		return withCandidate(output, (directory) =>
			Effect.gen(function* () {
				const reportPath = path.join(directory, "report.json");
				yield* runScenarioCli([
					"--scenario",
					sequence.id,
					"--report-out",
					reportPath,
					"--generator-command",
					"offline-generator",
				]);
				const report = yield* Schema.decodeUnknownEffect(Report)(
					yield* Effect.tryPromise(() => readFile(reportPath, "utf8")),
				);
				assert.isFalse(report.ok);
				assert.isUndefined(report.error);
				assert.deepStrictEqual(
					report.checks.filter((check) => !check.passed).map((check) => check.id),
					["message-order", "answered-calls", "returns-answer-calls"],
				);
				assert.strictEqual(process.exitCode, 1);
			}),
		);
	});

	for (const source of ["generator", "input"]) {
		it.live(`enforces scenario requirements on bare IR from ${source}`, () => {
			const output = JSON.stringify({
				...scenario.expectedDiagram,
				nodes: scenario.expectedDiagram.nodes.map((node) =>
					node.label === "Scope clear?" ? { ...node, label: "Different decision" } : node,
				),
			});
			return withCandidate(output, (directory) =>
				Effect.gen(function* () {
					const reportPath = path.join(directory, "report.json");
					const inputPath = path.join(directory, "candidate.json");
					yield* Effect.tryPromise(() => writeFile(inputPath, output));
					yield* runScenarioCli([
						"--scenario",
						scenario.id,
						"--report-out",
						reportPath,
						...(source === "input"
							? ["--input", inputPath]
							: ["--generator-command", "offline-generator"]),
					]);
					const report = yield* Schema.decodeUnknownEffect(Report)(
						yield* Effect.tryPromise(() => readFile(reportPath, "utf8")),
					);
					assert.isFalse(report.ok);
					assert.isUndefined(report.error);
					assert.isTrue(
						report.checks.some((check) => check.id === "node-label:Scope clear?" && !check.passed),
					);
					assert.strictEqual(process.exitCode, 1);
				}),
			);
		});
	}
	it.live("grades and replays the saved response envelope requested by the generator prompt", () =>
		withCandidate(generatedEnvelope(), (directory) =>
			Effect.gen(function* () {
				const reportPath = path.join(directory, "report.json");
				yield* runScenarioCli([
					"--scenario",
					scenario.id,
					"--report-out",
					reportPath,
					"--candidate-out-dir",
					directory,
					"--generator-command",
					"offline-generator",
				]);
				const report = yield* Schema.decodeUnknownEffect(Report)(
					yield* Effect.tryPromise(() => readFile(reportPath, "utf8")),
				);
				assert.isTrue(report.ok);
				const replayPath = path.join(directory, "replay.json");
				yield* runScenarioCli([
					"--scenario",
					scenario.id,
					"--input",
					path.join(directory, `${scenario.id}.candidate.txt`),
					"--report-out",
					replayPath,
				]);
				const replay = yield* Schema.decodeUnknownEffect(Report)(
					yield* Effect.tryPromise(() => readFile(replayPath, "utf8")),
				);
				assert.isTrue(replay.ok);
				assert.isUndefined(replay.error);
			}),
		),
	);

	for (const { name, scenarioId, icons, failing } of [
		{
			name: "a model that shifts every logo one node",
			scenarioId: "deploy-pipeline-logos",
			icons: { build: "github", tests: "docker", passed: "cloudflare" },
			failing: ["icons-on-named-steps"],
		},
		{
			name: "a model that puts a logo on a generic step",
			scenarioId: "sketchi-onboarding-decision-flow",
			icons: { [scenario.expectedDiagram.nodes[0]?.id ?? ""]: "github" },
			failing: ["icons-grounded", "icons-on-named-steps"],
		},
	] as const) {
		it.live(`scores logos before placement repairs ${name}`, () => {
			const target = getFlowchartScenario(scenarioId);
			const { title, ...diagram } = target.expectedDiagram;
			const modelIcons: Readonly<Record<string, string>> = icons;
			const output = JSON.stringify({
				title,
				intent: {
					requestedKind: "flowchart",
					nativeKind: "flowchart",
					requirements: [],
				},
				diagram: {
					...diagram,
					nodes: diagram.nodes.map(({ icon: _icon, ...node }) =>
						modelIcons[node.id] ? { ...node, icon: { slug: modelIcons[node.id] } } : node,
					),
				},
			});
			return withCandidate(output, (directory) =>
				Effect.gen(function* () {
					const reportPath = path.join(directory, "report.json");
					yield* runScenarioCli([
						"--scenario",
						target.id,
						"--report-out",
						reportPath,
						"--generator-command",
						"offline-generator",
					]);
					const report = yield* Schema.decodeUnknownEffect(Report)(
						yield* Effect.tryPromise(() => readFile(reportPath, "utf8")),
					);
					// Placement and grounding repaired the shipped diagram, so only
					// the logo check on the model's own output fails.
					assert.isFalse(report.ok);
					assert.deepStrictEqual(
						report.checks.filter((check) => !check.passed).map((check) => check.id),
						[...failing],
					);
				}),
			);
		});
	}

	it.live("still accepts bare IR input files", () =>
		withCandidate("", (directory) =>
			Effect.gen(function* () {
				const inputPath = path.join(directory, "bare.json");
				const reportPath = path.join(directory, "report.json");
				yield* Effect.tryPromise(() =>
					writeFile(inputPath, JSON.stringify(scenario.expectedDiagram)),
				);
				yield* runScenarioCli([
					"--scenario",
					scenario.id,
					"--input",
					inputPath,
					"--report-out",
					reportPath,
				]);
				const report = yield* Schema.decodeUnknownEffect(Report)(
					yield* Effect.tryPromise(() => readFile(reportPath, "utf8")),
				);
				assert.isTrue(report.ok);
			}),
		),
	);

	it.live("enforces the typed requirements when replaying an envelope", () =>
		withCandidate("", (directory) =>
			Effect.gen(function* () {
				const inputPath = path.join(directory, "candidate.txt");
				const reportPath = path.join(directory, "report.json");
				const output = generatedEnvelope([
					{ kind: "count", target: "nodes", comparator: "minimum", value: 18 },
				]);
				yield* Effect.tryPromise(() =>
					writeFile(inputPath, `Generated candidate:\n\`\`\`json\n${output}\n\`\`\``),
				);
				yield* runScenarioCli([
					"--scenario",
					scenario.id,
					"--input",
					inputPath,
					"--report-out",
					reportPath,
				]);
				const report = yield* Schema.decodeUnknownEffect(Report)(
					yield* Effect.tryPromise(() => readFile(reportPath, "utf8")),
				);
				assert.isFalse(report.ok);
				const intentCheck = report.checks.find((check) => check.id === "intent-contract");
				assert.isFalse(intentCheck?.passed);
				assert.include(intentCheck?.message ?? "", "requirement_count_not_met");
				assert.strictEqual(process.exitCode, 1);
			}),
		),
	);

	for (const [label, output] of [
		["invalid JSON", "not a diagram"],
		[
			"invalid IR",
			'{"title":"Bad","intent":{"requestedKind":"flowchart","nativeKind":"flowchart","requirements":[]},"diagram":{}}',
		],
		[
			"unsatisfied typed requirement",
			generatedEnvelope([{ kind: "count", target: "nodes", comparator: "minimum", value: 18 }]),
		],
		[
			"conflicting type",
			JSON.stringify({
				title: "Conflicting mindmap",
				intent: {
					requestedKind: "mindmap",
					nativeKind: "mindmap",
					requirements: [],
				},
				diagram: {
					id: "conflict",
					type: "mindmap",
					layout: { direction: "LR", edgeRouting: "curved" },
					root: { label: "Root", children: [{ label: "Topic", children: [] }] },
				},
			}),
		],
	]) {
		it.live(`preserves failed-run candidate and report evidence for ${label}`, () =>
			withCandidate(output ?? "", (directory) =>
				Effect.gen(function* () {
					const reportPath = path.join(directory, "report.json");
					yield* runScenarioCli([
						"--scenario",
						scenario.id,
						"--report-out",
						reportPath,
						"--candidate-out-dir",
						directory,
						"--generator-command",
						"offline-generator",
					]);
					const report = yield* Schema.decodeUnknownEffect(Report)(
						yield* Effect.tryPromise(() => readFile(reportPath, "utf8")),
					);
					assert.isFalse(report.ok);
					if (label === "unsatisfied typed requirement") {
						// The model's diagram is still scored; enforcement fails its own check.
						assert.isUndefined(report.error);
						assert.isTrue(report.checks.some((check) => check.id === "min-node-count"));
						assert.deepStrictEqual(
							report.checks.filter((check) => !check.passed).map((check) => check.id),
							["intent-contract"],
						);
					} else {
						assert.isDefined(report.error);
					}
					if (label === "conflicting type")
						assert.include(report.error ?? "", "explicit_type_not_met");
					assert.strictEqual(
						yield* Effect.tryPromise(() =>
							readFile(path.join(directory, `${scenario.id}.candidate.txt`), "utf8"),
						),
						output,
					);
					assert.strictEqual(process.exitCode, 1);
				}),
			),
		);
	}
});

describe("scenario CLI expected failures", () => {
	it.effect("maps an unknown scenario to a typed usage failure", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runScenarioCli(["--scenario", "unknown-scenario", "--fixture"]).pipe(
					Effect.provide(ToolProcessSpawnerLive),
				),
			);
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				const error = Cause.findError(exit.cause);
				assert.strictEqual(error._tag, "Success");
				if (error._tag === "Success") {
					assert.instanceOf(error.success, ScenarioCliUsageError);
					assert.include(error.success.message, 'Unknown scenario "unknown-scenario"');
					assert.strictEqual(scenarioCliExitCode(error.success), 2);
				}
			}
		}),
	);

	it.effect("maps invalid arguments to the same usage exit", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runScenarioCli(["--unknown"]).pipe(Effect.provide(ToolProcessSpawnerLive)),
			);
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				const error = Cause.findError(exit.cause);
				assert.strictEqual(error._tag, "Success");
				if (error._tag === "Success") {
					assert.instanceOf(error.success, ScenarioCliUsageError);
					assert.strictEqual(scenarioCliExitCode(error.success), 2);
				}
			}
		}),
	);

	it.live("maps a missing requested generator environment variable to usage exit 2", () =>
		Effect.gen(function* () {
			const variableName = "SKETCHI_TEST_MISSING_GENERATOR_COMMAND";
			const previousValue = process.env[variableName];
			delete process.env[variableName];
			const exit = yield* Effect.exit(
				runScenarioCli([
					"--scenario",
					"sketchi-onboarding-decision-flow",
					"--generator-command-env",
					variableName,
				]).pipe(Effect.provide(ToolProcessSpawnerLive)),
			).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						if (previousValue === undefined) {
							delete process.env[variableName];
						} else {
							process.env[variableName] = previousValue;
						}
					}),
				),
			);

			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				const error = Cause.findError(exit.cause);
				assert.strictEqual(error._tag, "Success");
				if (error._tag === "Success") {
					assert.instanceOf(error.success, ScenarioCliUsageError);
					assert.include(error.success.message, variableName);
					assert.strictEqual(scenarioCliExitCode(error.success), 2);
				}
			}
		}),
	);
});
