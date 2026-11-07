import {
	buildDiagramGenerationMessages,
	candidateFromText,
	DiagramGenerationClient,
	DiagramGenerationPolicy,
} from "@sketchi/diagram-generation";
import { getFlowchartScenario, toDiagramGenerationPrompt } from "@sketchi/diagram-scenarios";
import { assert, describe, expect, it, layer, vi } from "@effect/vitest";
import type { TelemetrySpanRow } from "@sketchi/observability";
import { Cause, Effect, Fiber, Layer, Exit } from "effect";
import { TestClock } from "effect/testing";

import {
	decodeGenerateScenarioInput,
	generateScenarioErrorPayload,
	GenerateScenarioInputValidationError,
	generateScenarioCandidatesForInput,
	runGenerateScenarioCandidatesForInput,
} from "./generate-scenario";

describe("eval harness scenario generation composition", () => {
	it.effect("formats invalid-provider paths from Effect Schema issues", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				decodeGenerateScenarioInput({
					providers: ["unsupported"],
					scenarioId: "sketchi-onboarding-decision-flow",
				}),
			);
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				const error = Cause.findError(exit.cause);
				assert.strictEqual(error._tag, "Success");
				if (error._tag === "Success") {
					assert.instanceOf(error.success, GenerateScenarioInputValidationError);
					if (error.success instanceof GenerateScenarioInputValidationError) {
						expect(error.success.issues).toEqual([
							{ path: ["providers", 0], message: expect.any(String) },
						]);
						const payload = generateScenarioErrorPayload(error.success);
						expect(typeof payload.error).toBe("string");
						expect(JSON.parse(payload.error)).toEqual(error.success.issues);
					}
				}
			}
		}),
	);

	it("reuses one lazy runtime for concurrent requests with the same bindings", async () => {
		const gateway = vi.fn(() => ({
			getUrl: vi.fn(),
			run: vi.fn(
				async () =>
					new Response(JSON.stringify({ error: { message: "invalid request" } }), { status: 400 }),
			),
		}));
		const bindings = { AI: { gateway } };
		expect(gateway).not.toHaveBeenCalled();
		const input = { scenarioId: "sketchi-onboarding-decision-flow" };
		const results = await Promise.all([
			runGenerateScenarioCandidatesForInput(input, bindings),
			runGenerateScenarioCandidatesForInput(input, bindings),
			runGenerateScenarioCandidatesForInput(input, bindings),
		]);
		expect(gateway).toHaveBeenCalledTimes(1);
		for (const result of results) expect(result.candidates[0]?.error).toBe("HTTP 400");
		await runGenerateScenarioCandidatesForInput(input, { AI: { gateway } });
		expect(gateway).toHaveBeenCalledTimes(2);
	});

	it("sends each concurrent request's spans, with its scenario, as its own batch", async () => {
		const sends: Array<ReadonlyArray<TelemetrySpanRow>> = [];
		const pending: Promise<unknown>[] = [];
		const bindings = {
			TELEMETRY_SPANS: {
				send: async (rows: readonly unknown[]) => {
					sends.push(rows as TelemetrySpanRow[]);
				},
			},
		};
		const scenarioIds = ["unknown-one", "unknown-two"];
		await Promise.all(
			scenarioIds.map((scenarioId) =>
				runGenerateScenarioCandidatesForInput({ scenarioId }, bindings, {
					request: new Request("https://eval.test/api/scenario-candidates", {
						headers: { "cf-ray": `ray-${scenarioId}`, "x-sketchi-run-id": `run-${scenarioId}` },
					}),
					waitUntil: (promise) => pending.push(promise),
				}),
			),
		);
		await Promise.all(pending);
		expect(sends).toHaveLength(2);
		for (const scenarioId of scenarioIds) {
			const batch = sends.find((rows) =>
				rows.some((row) => JSON.parse(row.attributes)["sketchi.scenario_id"] === scenarioId),
			);
			expect(batch?.map((row) => row.name)).toEqual(
				expect.arrayContaining(["evalHarness.generateScenarioCandidates", "evalHarness.request"]),
			);
			expect(new Set(batch?.map((row) => row.trace_id)).size).toBe(1);
			expect(batch?.every((row) => row.service === "sketchi-playground")).toBe(true);
			// Every span carries its own request's IDs, though the runtime is shared.
			for (const row of batch ?? []) {
				expect(row).toMatchObject({
					attempt_id: expect.stringMatching(/^attempt_/),
					ray_id: `ray-${scenarioId}`,
					run_id: `run-${scenarioId}`,
				});
			}
			expect(new Set(batch?.map((row) => row.attempt_id)).size).toBe(1);
		}
		expect(sends[0]?.[0]?.trace_id).not.toBe(sends[1]?.[0]?.trace_id);
	});

	it("forwards request cancellation through the runtime to the gateway", async () => {
		const started = Promise.withResolvers<AbortSignal>();
		const controller = new AbortController();
		const bindings = {
			AI: {
				gateway: () => ({
					getUrl: vi.fn(),
					run: vi.fn(
						(_data: unknown, options?: { signal?: AbortSignal }) =>
							new Promise<Response>((_resolve, reject) => {
								const signal = options?.signal;
								if (!signal) return reject(new Error("Missing upstream AbortSignal."));
								signal.addEventListener(
									"abort",
									() =>
										reject(
											signal.reason instanceof Error
												? signal.reason
												: new Error("Upstream request aborted."),
										),
									{ once: true },
								);
								started.resolve(signal);
							}),
					),
				}),
			},
		};
		const result = runGenerateScenarioCandidatesForInput(
			{ scenarioId: "sketchi-onboarding-decision-flow" },
			bindings,
			{ signal: controller.signal },
		);
		// oxlint-disable-next-line vitest/valid-expect -- attached before the abort and awaited below
		const rejection = expect(result).rejects.toBeDefined();
		const upstreamSignal = await started.promise;
		controller.abort();
		await rejection;
		expect(upstreamSignal.aborted).toBe(true);
	});

	it("adapts a maintained scenario before calling the generation client", async () => {
		const scenario = getFlowchartScenario("sketchi-onboarding-decision-flow");
		const { title, type, ...diagram } = scenario.expectedDiagram;
		const messages = buildDiagramGenerationMessages(toDiagramGenerationPrompt(scenario));
		const responseBody = {
			choices: [
				{
					finish_reason: "stop",
					index: 0,
					message: {
						content: JSON.stringify(
							{
								title,
								diagram: { ...diagram, type },
							},
							null,
							2,
						),
						role: "assistant",
					},
				},
			],
			created: 1,
			id: "chatcmpl-test",
			model: "gemini-3.1-flash-lite",
			usage: { completion_tokens: 23, prompt_tokens: 11, total_tokens: 34 },
		};
		const run = vi.fn(
			async () =>
				new Response(JSON.stringify(responseBody), {
					headers: { "Content-Type": "application/json" },
				}),
		);
		const result = await runGenerateScenarioCandidatesForInput(
			{
				providers: ["cloudflare-google-ai-studio"],
				scenarioId: scenario.id,
			},
			{
				AI: {
					gateway: () => ({ getUrl: vi.fn(), run }),
				},
			},
		);

		expect(run).toHaveBeenCalledWith(
			expect.objectContaining({
				endpoint: "v1beta/openai/chat/completions",
				query: expect.objectContaining({
					messages: [
						{ role: "system", content: messages.system },
						{ role: "user", content: messages.user },
					],
					model: "gemini-3.1-flash-lite",
				}),
			}),
			expect.objectContaining({
				gateway: expect.objectContaining({
					metadata: expect.objectContaining({
						scenarioId: scenario.id,
						sketchiSurface: "eval-harness",
						sketchiTraceId: expect.any(String),
					}),
					skipCache: true,
				}),
			}),
		);
		expect(result).toMatchObject({
			candidates: [
				{
					diagramValid: true,
					model: "gemini-3.1-flash-lite",
					provider: "cloudflare-google-ai-studio",
					usage: {
						inputTokens: 11,
						outputTokens: 23,
						totalTokens: 34,
					},
				},
			],
			model: "google/gemini-3.1-flash-lite",
			scenarioId: scenario.id,
		});
	});

	it("preserves the missing-provider response when the Worker binding is absent", async () => {
		const result = await runGenerateScenarioCandidatesForInput(
			{
				providers: ["cloudflare-google-ai-studio"],
				scenarioId: "sketchi-onboarding-decision-flow",
			},
			{},
		);

		expect(result).toEqual({
			candidates: [
				{
					diagnostics: [
						'Provider "cloudflare-google-ai-studio" is not configured in this Worker environment.',
					],
					diagramValid: false,
					error:
						'Provider "cloudflare-google-ai-studio" is not configured in this Worker environment.',
					model: "gemini-3.1-flash-lite",
					provider: "cloudflare-google-ai-studio",
					text: "",
				},
			],
			model: "google/gemini-3.1-flash-lite",
			scenarioId: "sketchi-onboarding-decision-flow",
		});
	});

	it("preserves HTTP candidate diagnostics at the runtime boundary", async () => {
		const result = await runGenerateScenarioCandidatesForInput(
			{
				providers: ["cloudflare-google-ai-studio"],
				scenarioId: "sketchi-onboarding-decision-flow",
			},
			{
				AI: {
					gateway: () => ({
						getUrl: vi.fn(),
						run: vi.fn(
							async () =>
								new Response(JSON.stringify({ error: { message: "invalid request" } }), {
									status: 400,
								}),
						),
					}),
				},
			},
		);

		expect(result).toEqual({
			candidates: [
				{
					diagnostics: [
						"Google AI Studio Gateway request failed with HTTP 400.",
						"invalid request",
					],
					diagramValid: false,
					durationMs: expect.any(Number),
					error: "HTTP 400",
					model: "gemini-3.1-flash-lite",
					provider: "cloudflare-google-ai-studio",
					text: "",
				},
			],
			model: "google/gemini-3.1-flash-lite",
			scenarioId: "sketchi-onboarding-decision-flow",
		});
	});

	it("normalizes a throwing gateway factory into the prior candidate response", async () => {
		const result = await runGenerateScenarioCandidatesForInput(
			{
				providers: ["cloudflare-google-ai-studio"],
				scenarioId: "sketchi-onboarding-decision-flow",
			},
			{
				AI: {
					gateway: () => {
						throw new Error("gateway factory unavailable");
					},
				},
			},
		);

		expect(result).toEqual({
			candidates: [
				{
					diagnostics: ["gateway factory unavailable"],
					diagramValid: false,
					error: "gateway factory unavailable",
					model: "gemini-3.1-flash-lite",
					provider: "cloudflare-google-ai-studio",
					text: "",
				},
			],
			model: "google/gemini-3.1-flash-lite",
			scenarioId: "sketchi-onboarding-decision-flow",
		});
	});

	it("preserves the unknown-scenario candidate response", async () => {
		const gateway = vi.fn(() => ({
			getUrl: vi.fn(async () => ""),
			run: vi.fn(async () => new Response()),
		}));
		const result = await runGenerateScenarioCandidatesForInput(
			{
				providers: ["cloudflare-google-ai-studio"],
				scenarioId: "unknown-scenario",
			},
			{ AI: { gateway } },
		);

		expect(result).toEqual({
			candidates: [
				{
					diagnostics: ['Unknown scenario "unknown-scenario".'],
					diagramValid: false,
					error: 'Unknown scenario "unknown-scenario".',
					model: "gemini-3.1-flash-lite",
					provider: "cloudflare-google-ai-studio",
					text: "",
				},
			],
			model: "google/gemini-3.1-flash-lite",
			scenarioId: "unknown-scenario",
		});
		expect(gateway).toHaveBeenCalledTimes(1);
	});
});

let activeGenerationCount = 0;
let generationCallCount = 0;
let maxActiveGenerationCount = 0;
const concurrencyScenario = getFlowchartScenario("sketchi-onboarding-decision-flow");
const concurrencyLayer = Layer.mergeAll(
	Layer.succeed(DiagramGenerationClient, {
		provider: "cloudflare-google-ai-studio",
		generate: Effect.fn("diagramGeneration.test.concurrency")(function* () {
			generationCallCount += 1;
			activeGenerationCount += 1;
			maxActiveGenerationCount = Math.max(maxActiveGenerationCount, activeGenerationCount);
			yield* Effect.sleep("1 second");
			activeGenerationCount -= 1;

			return candidateFromText({
				model: "test-model",
				provider: "cloudflare-google-ai-studio",
				text: JSON.stringify(concurrencyScenario.expectedDiagram),
			});
		}),
	}),
	Layer.succeed(DiagramGenerationPolicy, {
		concurrency: 1,
		maxRepairAttempts: 1,
		maxRetries: 0,
		requestTimeoutMs: 1_000,
		retryDelayMs: 0,
		totalTimeoutMs: 60_000,
	}),
);

layer(concurrencyLayer)("eval generation policy", (it) => {
	it.effect("drives bounded forEach concurrency from the provided policy", () =>
		Effect.gen(function* () {
			activeGenerationCount = 0;
			generationCallCount = 0;
			maxActiveGenerationCount = 0;
			const fiber = yield* Effect.forkChild(
				generateScenarioCandidatesForInput({
					providers: [
						"cloudflare-google-ai-studio",
						"cloudflare-google-ai-studio",
						"cloudflare-google-ai-studio",
					],
					scenarioId: concurrencyScenario.id,
				}),
			);
			yield* TestClock.adjust("5 seconds");
			const result = yield* Fiber.join(fiber);

			assert.strictEqual(result.candidates.length, 3);
			assert.strictEqual(generationCallCount, 3);
			assert.strictEqual(maxActiveGenerationCount, 1);
		}),
	);
});
