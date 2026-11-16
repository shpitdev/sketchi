// Positive fixtures deliberately unwrap Results: failure here is invalid test data, not user input.
import { withTelemetryCorrelation } from "@sketchi/observability";
import {
	type CloudflareAiGateway,
	CloudflareAiGatewayBinding,
} from "@sketchi/cloudflare/ai-gateway";
import { Cause, Effect, Exit, Fiber, Layer, Result } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { TestClock } from "effect/testing";

import { parseFlowchartDiagram } from "../../families/flowchart/document";
import {
	candidateFromText,
	type DiagramGenerationCandidate,
	type DiagramGenerationRequest,
} from "../candidates";
import {
	DiagramGenerationClient,
	DiagramGenerationPolicy,
	type DiagramGenerationPolicyConfig,
	diagramGenerationPolicyDefaults,
	MEASURED_OUTPUT_TOKENS_PER_SECOND,
} from "../client";
import {
	anthropicGatewayChatRoute,
	CloudflareGatewayChatClientLive,
	CloudflareGatewayChatConfig,
	type GatewayChatRoute,
	googleGatewayChatRoute,
} from "../cloudflare-gateway-chat";
import { DiagramGenerationHttpError } from "../errors";
import { buildDiagramGenerationMessages, DEFAULT_MAX_OUTPUT_TOKENS } from "../messages";
import { runDiagramGenerationWithPolicy } from "../policy";

type RunArgs = Parameters<CloudflareAiGateway["run"]>;
type RunFn = (...args: RunArgs) => Promise<Response>;

const answer = JSON.stringify({
	title: "Flow",
	diagram: {
		type: "flowchart",
		id: "flow",
		nodes: { a: "Start", b: "End" },
		edges: [["a", "b"]],
	},
});

function completion(
	content: string | null,
	finishReason: string | null = "stop",
	usage: unknown = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
) {
	return Response.json({
		id: "chatcmpl-1",
		object: "chat.completion",
		created: 1,
		model: "gemini-3.1-flash-lite",
		choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content } }],
		usage,
	});
}

const testPolicy: DiagramGenerationPolicyConfig = {
	concurrency: 1,
	maxRepairAttempts: 0,
	maxRetries: 0,
	requestTimeoutMs: 5_000,
	retryDelayMs: 1,
	totalTimeoutMs: 60_000,
};

function clientLayer(
	run: RunFn,
	policy: Partial<DiagramGenerationPolicyConfig> = {},
	route: GatewayChatRoute = googleGatewayChatRoute,
) {
	return CloudflareGatewayChatClientLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(CloudflareAiGatewayBinding, {
					gateway: () => ({ run, getUrl: () => Promise.resolve("https://gateway.invalid") }),
				}),
				Layer.succeed(CloudflareGatewayChatConfig, {
					collectLog: true,
					gatewayId: "test",
					route,
					surface: "generate-api",
				}),
				Layer.succeed(DiagramGenerationPolicy, { ...testPolicy, ...policy }),
			),
		),
	);
}

const prompt = { id: "scenario-1", request: "Draw it" };
const request = { model: "google/gemini-3.1-flash-lite", prompt };
const haiku = { ...request, model: "anthropic/claude-haiku-5-5" };

function generate(
	layer: ReturnType<typeof clientLayer>,
	input: typeof request & { temperature?: number } = request,
) {
	return Effect.flatMap(DiagramGenerationClient, (client) => client.generate(input)).pipe(
		Effect.provide(layer),
	);
}

function capture(response: () => Response = () => completion(answer)) {
	const calls: RunArgs[] = [];
	const run: RunFn = async (...args) => {
		calls.push(args);
		return response();
	};
	return { calls, run };
}

describe("the gateway client", () => {
	const { system, user } = buildDiagramGenerationMessages(prompt);
	const messages = [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];

	it.each([
		[
			"Google",
			googleGatewayChatRoute,
			request,
			{
				endpoint: "v1beta/openai/chat/completions",
				provider: "google-ai-studio",
				query: {
					model: "gemini-3.1-flash-lite",
					messages,
					max_tokens: 16_384,
					response_format: { type: "json_object" },
					temperature: 0.4,
				},
			},
			"cloudflare-google-ai-studio",
		],
		[
			"Anthropic",
			anthropicGatewayChatRoute,
			haiku,
			{
				endpoint: "v1/chat/completions",
				provider: "anthropic",
				query: {
					model: "claude-haiku-5-5",
					messages,
					max_tokens: 16_384,
					thinking: { type: "disabled" },
				},
			},
			"cloudflare-anthropic",
		],
	] as const)(
		"sends %s the request its provider accepts, joined to the trace",
		async (_name, route, input, body, provider) => {
			const { calls, run } = capture();
			const candidate = await Effect.runPromise(
				withTelemetryCorrelation(
					generate(clientLayer(run, {}, route), { ...input, temperature: 0.4 }),
					{
						traceId: "trace_abc",
					},
				),
			);
			const [data, options] = calls[0] ?? [];
			expect(data).toEqual({ ...body, headers: { "Content-Type": "application/json" } });
			expect(options?.gateway?.skipCache).toBe(true);
			const metadata = options?.gateway?.metadata ?? {};
			expect(metadata).toMatchObject({ sketchiProvider: provider, sketchiTraceId: "trace_abc" });
			// AI Gateway accepts at most five metadata entries.
			expect(Object.keys(metadata).length).toBeLessThanOrEqual(5);
			expect(candidate).toMatchObject({
				provider,
				usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
			});
			expect(candidate.diagram?.type).toBe("flowchart");
		},
	);

	it.each([
		[429, true, googleGatewayChatRoute, request],
		[503, true, googleGatewayChatRoute, request],
		[529, true, anthropicGatewayChatRoute, haiku],
		[400, false, googleGatewayChatRoute, request],
		[404, false, googleGatewayChatRoute, request],
		[400, false, anthropicGatewayChatRoute, haiku],
	] as const)(
		"retries HTTP %i up to the cap only when it can succeed: %s",
		async (status, retryable, route, input) => {
			const { calls, run } = capture(() =>
				Response.json({ error: { message: "upstream said no" } }, { status }),
			);
			const error = await Effect.runPromise(
				generate(clientLayer(run, { maxRetries: 2 }, route), input).pipe(Effect.flip),
			);
			expect(error).toMatchObject({ _tag: "DiagramGenerationHttpError", retryable, status });
			expect(calls).toHaveLength(retryable ? 3 : 1);
		},
	);

	it("retries a broken connection", async () => {
		let calls = 0;
		const layer = clientLayer(
			async () => {
				calls += 1;
				if (calls === 1) throw new Error("binding exploded");
				return completion(answer);
			},
			{ maxRetries: 2 },
		);
		const candidate = await Effect.runPromise(generate(layer));
		expect(candidate.diagram?.type).toBe("flowchart");
		expect(calls).toBe(2);
	});

	it("retries an answer whose body breaks after the headers, as transport", async () => {
		let calls = 0;
		const layer = clientLayer(
			async () => {
				calls += 1;
				if (calls > 1) return completion(answer);
				return new Response(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							controller.error(new Error("body broke"));
						},
					}),
				);
			},
			{ maxRetries: 2, maxRepairAttempts: 2 },
		);
		const candidate = await Effect.runPromise(generate(layer));
		expect(candidate.diagram?.type).toBe("flowchart");
		expect(calls).toBe(2);
	});

	it.each([
		["empty content", () => completion("")],
		["not JSON", () => new Response("<html>")],
		["no body", () => new Response(null, { status: 204 })],
		["filtered content", () => completion(null, "content_filter")],
	])("fails %s after one call", async (_name, response) => {
		const { calls, run } = capture(response);
		const error = await Effect.runPromise(
			generate(clientLayer(run, { maxRetries: 2, maxRepairAttempts: 2 })).pipe(Effect.flip),
		);
		expect(error._tag).toBe("DiagramGenerationResponseError");
		expect(calls).toHaveLength(1);
	});

	it("fails an answer cut off at the output limit once, without regenerating or repairing it", async () => {
		const { calls, run } = capture(() => completion('{"title":', "length"));
		const error = await Effect.runPromise(
			generate(clientLayer(run, { maxRepairAttempts: 2, maxRetries: 2 })).pipe(Effect.flip),
		);
		expect(calls).toHaveLength(1);
		expect(error).toMatchObject({
			_tag: "DiagramGenerationLimitError",
			limit: "output_tokens",
		});
	});

	it("aborts the gateway call when an attempt times out", async () => {
		let aborted = false;
		const layer = clientLayer(
			(_data, options) =>
				new Promise<Response>((_resolve, reject) => {
					options?.signal?.addEventListener(
						"abort",
						() => {
							aborted = true;
							reject(new Error("aborted"));
						},
						{ once: true },
					);
				}),
			{ requestTimeoutMs: 20 },
		);
		const error = await Effect.runPromise(generate(layer).pipe(Effect.flip));
		expect(error._tag).toBe("DiagramGenerationTimeoutError");
		expect(aborted).toBe(true);
	});

	it("aborts the gateway call when the caller interrupts mid-answer, as an interruption", async () => {
		const reading = Promise.withResolvers<void>();
		let calls = 0;
		let gatewaySignal: AbortSignal | undefined;
		const layer = clientLayer(
			async (_data, options) => {
				calls += 1;
				const signal = options?.signal;
				if (!signal) throw new Error("Expected a gateway signal");
				gatewaySignal = signal;
				return new Response(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							reading.resolve();
							return new Promise<void>((_resolve, reject) => {
								signal.addEventListener(
									"abort",
									() => {
										controller.error(new Error("body aborted"));
										reject(new Error("body aborted"));
									},
									{ once: true },
								);
							});
						},
					}),
				);
			},
			{ maxRetries: 2, maxRepairAttempts: 2 },
		);
		const fiber = Effect.runFork(generate(layer));
		await reading.promise;
		expect(gatewaySignal?.aborted).toBe(false);
		await Effect.runPromise(Fiber.interrupt(fiber));
		const exit = await Effect.runPromise(Fiber.await(fiber));
		expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
		expect(gatewaySignal?.aborted).toBe(true);
		expect(calls).toBe(1);
	});

	it("gives one call time to write the whole output budget, inside the request's limit", () => {
		const { requestTimeoutMs, totalTimeoutMs } = diagramGenerationPolicyDefaults;
		const fullBudgetMs = (DEFAULT_MAX_OUTPUT_TOKENS / MEASURED_OUTPUT_TOKENS_PER_SECOND) * 1_000;
		expect(requestTimeoutMs).toBeGreaterThan(fullBudgetMs + 5_000);
		expect(totalTimeoutMs).toBeGreaterThan(requestTimeoutMs);
	});
});

describe("the generation policy", () => {
	const policyRequest: DiagramGenerationRequest = {
		model: "fixture-model",
		prompt: {
			id: "refund-flow",
			request: "Draw the refund approval flow.",
			requestedType: "flowchart",
		},
	};
	const acceptedDiagram = parseFlowchartDiagram({
		id: "refund-flow",
		title: "Refund approval",
		type: "flowchart",
		nodes: [
			{ id: "start", kind: "start", label: "Receive return" },
			{ id: "done", kind: "end", label: "Refund issued" },
		],
		edges: [{ id: "start-done", source: "start", target: "done" }],
	}).pipe(Result.getOrThrow);
	const issue = 'flowchart.underbranched_decision: Decision node "approve" needs two branches.';
	const invalid = (text: string, diagnostics = [issue]): DiagramGenerationCandidate => ({
		provider: "fixture",
		model: policyRequest.model,
		text,
		error: "Invalid.",
		diagnostics,
	});
	const accepted: DiagramGenerationCandidate = {
		provider: "fixture",
		model: policyRequest.model,
		text: "accepted",
		diagram: acceptedDiagram,
		diagnostics: [],
	};
	const policy = { ...testPolicy, maxRepairAttempts: 2, requestTimeoutMs: 1_000 };

	/** Runs the policy over `answers` in order, recording each call. */
	const run = (
		answers: readonly DiagramGenerationCandidate[],
		config: DiagramGenerationPolicyConfig = policy,
	) => {
		const calls: DiagramGenerationRequest[] = [];
		const result = runDiagramGenerationWithPolicy(
			(input) =>
				Effect.suspend(() => {
					const candidate = answers[calls.length];
					calls.push(input);
					return candidate ? Effect.succeed(candidate) : Effect.die(new Error("Unexpected call."));
				}),
			policyRequest,
			"fixture",
			config,
		);
		return { calls, result };
	};

	it.effect("delivers a repair that validates", () =>
		Effect.gen(function* () {
			const { calls, result } = run([invalid("first"), invalid("second"), accepted]);
			const candidate = yield* result;
			expect(calls).toHaveLength(3);
			expect(candidate.diagram).toEqual(acceptedDiagram);
		}),
	);

	it.effect.each([
		["stops when a repair repeats the attempt before it", ["same", "same", "unused", "unused"], 2],
		["stops at the repair cap", ["first", "second", "third", "fourth"], 3],
	] as const)("%s", ([_name, texts, expectedCalls]) =>
		Effect.gen(function* () {
			const { calls, result } = run(texts.map((text) => invalid(text)));
			const candidate = yield* result;
			expect(calls).toHaveLength(expectedCalls);
			expect(candidate.diagram).toBeUndefined();
			expect(candidate.error).toBeDefined();
		}),
	);

	it.effect("refuses an oversized mindmap without another model call", () =>
		Effect.gen(function* () {
			const oversized = candidateFromText({
				model: "fixture-model",
				provider: "fixture",
				text: JSON.stringify({
					title: "Every topic",
					diagram: {
						type: "mindmap",
						root: {
							label: "Plan",
							children: Array.from({ length: 210 }, (_, index) => ({ label: `Topic ${index}` })),
						},
					},
				}),
			});
			const { calls, result } = run([oversized, oversized]);
			const error = yield* Effect.flip(result);
			expect(calls).toHaveLength(1);
			expect(error).toMatchObject({ _tag: "DiagramGenerationLimitError", limit: "diagram_size" });
		}),
	);

	it.effect("repairs a layout bound, which restructuring meets without dropping content", () =>
		Effect.gen(function* () {
			const { calls, result } = run([
				invalid("deep", [
					"wireframe.wireframe_too_large: Components nest 10 levels deep; a wireframe draws at most 8. Hint: Remove wrappers that hold a single child.",
				]),
				accepted,
			]);
			const candidate = yield* result;
			expect(calls).toHaveLength(2);
			expect(candidate.diagram).toBeDefined();
		}),
	);

	const deadline = {
		...policy,
		maxRetries: 2,
		requestTimeoutMs: 5_000,
		retryDelayMs: 150,
		totalTimeoutMs: 1_000,
	};

	it.effect("reports a repair that runs past the request's limit as a timeout", () =>
		Effect.gen(function* () {
			let calls = 0;
			const fiber = yield* Effect.forkChild(
				Effect.flip(
					runDiagramGenerationWithPolicy(
						() =>
							Effect.suspend(() => {
								calls += 1;
								return calls === 1 ? Effect.succeed(invalid("first")) : Effect.never;
							}),
						policyRequest,
						"fixture",
						deadline,
					),
				),
			);
			yield* TestClock.adjust("2 seconds");
			const error = yield* Fiber.join(fiber);
			expect(calls).toBe(2);
			expect(error).toMatchObject({ _tag: "DiagramGenerationTimeoutError", scope: "request" });
		}),
	);

	it.effect("dispatches no call once a retry's backoff reaches the request's limit", () =>
		Effect.gen(function* () {
			let calls = 0;
			const busy = DiagramGenerationHttpError.make({
				diagnostics: ["busy"],
				durationMs: 1,
				provider: "fixture",
				raw: {},
				retryable: true,
				status: 503,
			});
			const fiber = yield* Effect.forkChild(
				Effect.flip(
					runDiagramGenerationWithPolicy(
						() =>
							Effect.suspend(() => {
								calls += 1;
								return Effect.fail(busy);
							}),
						policyRequest,
						"fixture",
						{ ...deadline, totalTimeoutMs: 40 },
					),
				),
			);
			yield* TestClock.adjust("1 second");
			const error = yield* Fiber.join(fiber);
			expect(calls).toBe(1);
			expect(error).toMatchObject({ _tag: "DiagramGenerationTimeoutError", scope: "request" });
		}),
	);
});
