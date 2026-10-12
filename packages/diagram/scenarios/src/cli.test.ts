import { assert, describe, it } from "@effect/vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Cause, Effect, Exit, Layer, Schema } from "effect";

import { runScenarioCli, ScenarioCliUsageError, scenarioCliExitCode } from "./cli.js";
import { ToolProcessSpawner, ToolProcessSpawnerLive } from "./internal/tool-process.js";
import { getFlowchartScenario } from "./lib/scenarios.js";
import { getSequenceScenario } from "./lib/sequence-scenarios.js";
import { diagramScenarios } from "./lib/diagram-scenarios.js";
import { vi } from "vitest";

const ExecuteFixture = Schema.Struct({
	ok: Schema.Boolean,
	result: Schema.Struct({
		ok: Schema.Boolean,
		status: Schema.String,
		normalizedSpec: Schema.Unknown,
	}),
});

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
	for (const [bridgeLabel, connected] of [
		["artifact", false],
		["agent", true],
		["Unrelated work", true],
	] as const) {
		it.live(
			`grades 24 ambiguously labeled nodes without hanging (bridge: ${bridgeLabel})`,
			() =>
				withCandidate("", (directory) =>
					Effect.gen(function* () {
						const scenario = getFlowchartScenario("repo-package-interaction-flow");
						const diagram = {
							...scenario.expectedDiagram,
							nodes: [
								{ id: "start", label: "App request", kind: "start" },
								...Array.from({ length: 21 }, (_, index) => ({
									id: `p${index}`,
									// The negative path cannot complete the later steps before
									// crossing its artifact barrier and going back to core.
									label:
										!connected && index >= 6
											? "agent core"
											: "agent core renderer Excalidraw export artifact",
									kind: "process",
								})),
								{ id: "bridge", label: bridgeLabel, kind: "process" },
								{ id: "end", label: "Hosted response", kind: "end" },
							],
							edges: [
								{ id: "a", source: "start", target: "p0" },
								{ id: "bridge-a", source: "p0", target: "bridge" },
								{ id: "bridge-b", source: "bridge", target: "p1" },
								{ id: "padding-start", source: "start", target: "p6" },
								...Array.from({ length: 14 }, (_, index) => ({
									id: `padding-${index}`,
									source: `p${index + 6}`,
									target: `p${index + 7}`,
								})),
								{ id: "padding-end", source: "p20", target: "bridge" },
								{ id: "b", source: "p1", target: "p2" },
								{ id: "c", source: "p2", target: "p3" },
								{ id: "d", source: "p3", target: "p4" },
								{ id: "e", source: "p4", target: "p5" },
								{ id: "f", source: "p5", target: "end" },
							],
						};
						const inputPath = path.join(directory, "ambiguous-build.json");
						yield* Effect.tryPromise(() =>
							writeFile(
								inputPath,
								JSON.stringify({ ok: true, status: "accepted", normalizedSpec: diagram }),
							),
						);
						// A child-process deadline can interrupt synchronous search; a test
						// runner's ordinary async timeout cannot stop an infinite recursion.
						const result = spawnSync(
							process.execPath,
							[
								"--import",
								"jiti/register",
								"packages/diagram/scenarios/src/cli.ts",
								"--scenario",
								scenario.id,
								"--input",
								inputPath,
							],
							{ encoding: "utf8", timeout: 10_000 },
						);
						assert.strictEqual(result.error, undefined);
						const report = Schema.decodeUnknownSync(Report)(result.stdout);
						assert.strictEqual(
							result.status,
							connected ? 0 : 1,
							JSON.stringify(report.checks.filter((check) => !check.passed)),
						);
						assert.strictEqual(report.ok, connected);
						assert.strictEqual(
							report.checks.find((check) => check.id === "mcp-build-accepted")?.passed,
							true,
						);
						assert.strictEqual(
							report.checks
								.filter((check) => check.id.startsWith("edge:"))
								.every((check) => check.passed),
							connected,
						);
					}),
				),
			// Leave time for setup/cleanup around the hard child-process deadline.
			20_000,
		);
	}

	it.live("lists exact user prompts for every scenario", () =>
		Effect.sync(() => {
			const log = vi.spyOn(console, "log").mockImplementation(() => {});
			return log;
		}).pipe(
			Effect.flatMap((log) =>
				runScenarioCli(["--list"]).pipe(
					Effect.andThen(
						Effect.sync(() => {
							const output = Schema.decodeUnknownSync(
								Schema.fromJsonString(
									Schema.Array(Schema.Struct({ id: Schema.String, prompt: Schema.String })),
								),
							)(log.mock.calls[0]?.[0]);
							assert.deepStrictEqual(
								output,
								diagramScenarios.map(({ id, prompt }) => ({ id, prompt })),
							);
						}),
					),
					Effect.ensuring(Effect.sync(() => log.mockRestore())),
				),
			),
			Effect.provide(ToolProcessSpawnerLive),
		),
	);

	for (const [family, scenarioId, fixtureName] of [
		["flowchart", "incident-escalation", "flowchart-execute"],
		["flowchart", "sketchi-onboarding-decision-flow", "onboarding-execute"],
		["sequence", "checkout-payment-sequence", "sequence-execute"],
	] as const) {
		for (const shape of ["structuredContent", "build", "tool-result", "build-receipts"] as const) {
			it.live(`grades ${scenarioId} execute ${shape} through --input`, () =>
				withCandidate("", (directory) =>
					Effect.gen(function* () {
						const fixture = yield* Schema.decodeUnknownEffect(
							Schema.fromJsonString(ExecuteFixture),
						)(
							yield* Effect.tryPromise(() =>
								readFile(new URL(`./lib/fixtures/${fixtureName}.json`, import.meta.url), "utf8"),
							),
						);
						const input =
							shape === "build-receipts"
								? {
										structuredContent: {
											ok: true,
											result: { summary: "done" },
											builds: [
												{
													...fixture.result,
													operation:
														family === "sequence" ? "buildSequenceDiagram" : "buildFlowchart",
												},
											],
										},
									}
								: shape === "build"
									? fixture.result
									: shape === "tool-result"
										? { structuredContent: fixture }
										: fixture;
						const inputPath = path.join(directory, "execute.json");
						const reportPath = path.join(directory, "report.json");
						yield* Effect.tryPromise(() => writeFile(inputPath, JSON.stringify(input)));
						yield* runScenarioCli([
							"--scenario",
							scenarioId,
							"--input",
							inputPath,
							"--report-out",
							reportPath,
						]);
						const report = yield* Schema.decodeUnknownEffect(Report)(
							yield* Effect.tryPromise(() => readFile(reportPath, "utf8")),
						);
						assert.isUndefined(report.error);
						assert.deepStrictEqual(
							report.checks.find((check) => check.id === "mcp-build-accepted"),
							{
								id: "mcp-build-accepted",
								passed: true,
								message: "MCP build was accepted and returned a normalizedSpec.",
							},
						);
						assert.isTrue(
							report.checks.some(
								(check) =>
									check.id === (family === "flowchart" ? "min-node-count" : "message-order"),
							),
						);
						assert.isTrue(report.ok);
						assert.isTrue(report.checks.every((check) => check.passed));
					}),
				),
			);
		}
	}

	for (const [name, input, message] of [
		[
			"protocol-level MCP failure",
			{ content: [{ type: "text", text: "Error: Code execution timed out" }], isError: true },
			"Code execution timed out",
		],
		[
			"execute failure",
			{ ok: false, error: "Code execution timed out", logs: [] },
			"Code execution timed out",
		],
		[
			"unaccepted build",
			{
				ok: true,
				result: { ok: false, status: "quality_failed", normalizedSpec: scenario.expectedDiagram },
			},
			"quality_failed",
		],
		["missing spec", { ok: true, status: "accepted" }, "normalizedSpec"],
	] as const) {
		it.live(`reports ${name} as a failing check without crashing`, () =>
			withCandidate("", (directory) =>
				Effect.gen(function* () {
					const inputPath = path.join(directory, "execute.json");
					const reportPath = path.join(directory, "report.json");
					yield* Effect.tryPromise(() => writeFile(inputPath, JSON.stringify(input)));
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
					assert.isUndefined(report.error);
					assert.strictEqual(report.checks.length, 1);
					assert.strictEqual(report.checks[0]?.id, "mcp-build-accepted");
					assert.isFalse(report.checks[0]?.passed);
					assert.include(report.checks[0]?.message ?? "", message);
					assert.strictEqual(process.exitCode, 1);
				}),
			),
		);
	}

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
