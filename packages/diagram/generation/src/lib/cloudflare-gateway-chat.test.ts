import {
	makeTelemetryTestSink,
	makeWorkersTelemetryLayer,
	withTelemetryCorrelation,
} from "@sketchi/observability";
import { Cause, Effect, Exit, Fiber, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
	DiagramGenerationClient,
	DiagramGenerationPolicy,
	type DiagramGenerationPolicyConfig,
} from "./client.js";
import { type CloudflareAiGateway, CloudflareAiGatewayBinding } from "./cloudflare-ai-gateway.js";
import {
	anthropicGatewayChatRoute,
	CloudflareGatewayChatClientLive,
	CloudflareGatewayChatConfig,
	gatewayChatRouteForModel,
	type GatewayChatRoute,
	googleGatewayChatRoute,
} from "./cloudflare-gateway-chat.js";
import { buildDiagramGenerationMessages } from "./messages.js";

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
	init?: ResponseInit,
) {
	return Response.json(
		{
			id: "chatcmpl-1",
			object: "chat.completion",
			created: 1,
			model: "gemini-3.1-flash-lite",
			choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content } }],
			usage,
		},
		init,
	);
}

const testPolicy: DiagramGenerationPolicyConfig = {
	concurrency: 1,
	maxRepairAttempts: 0,
	maxRetries: 0,
	requestTimeoutMs: 5_000,
	retryDelayMs: 1,
	totalTimeoutMs: 60_000,
};

function bindingLayer(run: RunFn) {
	return Layer.succeed(CloudflareAiGatewayBinding, {
		gateway: () => ({ run, getUrl: () => Promise.resolve("https://gateway.invalid") }),
	});
}

function clientLayer(
	run: RunFn,
	policy: Partial<DiagramGenerationPolicyConfig> = {},
	route: GatewayChatRoute = googleGatewayChatRoute,
) {
	return CloudflareGatewayChatClientLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				bindingLayer(run),
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
type GenerationInput = typeof request & {
	maxOutputTokens?: number;
	temperature?: number;
};

function generate(layer: ReturnType<typeof clientLayer>, input: GenerationInput = request) {
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

describe("gateway chat request", () => {
	it("sends the Google route with the stored key and the current client's settings", async () => {
		const { calls, run } = capture();
		const candidate = await Effect.runPromise(
			generate(clientLayer(run), {
				...request,
				maxOutputTokens: 123,
				temperature: 0.4,
			}),
		);
		const { system, user } = buildDiagramGenerationMessages(prompt);
		const [data, options] = calls[0] ?? [];
		expect(data).toEqual({
			endpoint: "v1beta/openai/chat/completions",
			provider: "google-ai-studio",
			headers: { "Content-Type": "application/json" },
			query: {
				model: "gemini-3.1-flash-lite",
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
				max_tokens: 123,
				response_format: { type: "json_object" },
				temperature: 0.4,
			},
		});
		expect(options?.gateway?.collectLog).toBe(true);
		expect(options?.gateway?.skipCache).toBe(true);
		expect(options?.signal).toBeInstanceOf(AbortSignal);
		expect(candidate).toMatchObject({
			model: "gemini-3.1-flash-lite",
			provider: "cloudflare-google-ai-studio",
			usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
		});
		expect(candidate.diagram?.type).toBe("flowchart");
	});

	it("defaults max tokens and temperature", async () => {
		const { calls, run } = capture();
		await Effect.runPromise(generate(clientLayer(run)));
		expect(calls[0]?.[0].query).toMatchObject({ max_tokens: 16_384, temperature: 0.1 });
	});

	it("joins gateway logs to the request through at most five metadata entries", async () => {
		const { calls, run } = capture();
		await Effect.runPromise(
			withTelemetryCorrelation(generate(clientLayer(run)), { traceId: "trace_abc" }),
		);
		const metadata = calls[0]?.[1]?.gateway?.metadata;
		expect(metadata).toEqual({
			scenarioId: "scenario-1",
			sketchiProvider: "cloudflare-google-ai-studio",
			sketchiSurface: "generate-api",
			sketchiTraceId: "trace_abc",
		});
		expect(Object.keys(metadata ?? {}).length).toBeLessThanOrEqual(5);
	});

	it("falls back to the span's trace id when the request has no correlation id", async () => {
		const { calls, run } = capture();
		await Effect.runPromise(generate(clientLayer(run)));
		expect(calls[0]?.[1]?.gateway?.metadata?.["sketchiTraceId"]).toEqual(expect.any(String));
	});
});

describe("gateway chat responses", () => {
	it("fails an answer cut off at the output limit once, without regenerating or repairing it", async () => {
		const { calls, run } = capture(() =>
			completion('{"title":', "length", {
				prompt_tokens: 11,
				completion_tokens: 16_384,
				total_tokens: 16_395,
			}),
		);
		const error = await Effect.runPromise(
			generate(clientLayer(run, { maxRepairAttempts: 2, maxRetries: 2 })).pipe(Effect.flip),
		);
		expect(calls).toHaveLength(1);
		expect(error).toMatchObject({
			_tag: "DiagramGenerationLimitError",
			limit: "output_tokens",
			message: "The diagram needs more than the 16,384-token output limit allows in one answer.",
			diagnostics: [
				"output_truncated: Gemini stopped at the 16,384-token output limit after 16,384 tokens.",
			],
		});
	});

	it("names the requested budget when a request sets its own", async () => {
		const { run } = capture(() => completion(null, "length", null));
		const error = await Effect.runPromise(
			generate(clientLayer(run), { ...request, maxOutputTokens: 512 }).pipe(Effect.flip),
		);
		expect(error).toMatchObject({
			_tag: "DiagramGenerationLimitError",
			diagnostics: ["output_truncated: Gemini stopped at the 512-token output limit."],
		});
	});

	it("omits usage when the upstream sends none", async () => {
		const { run } = capture(() => completion(answer, "stop", null));
		const candidate = await Effect.runPromise(generate(clientLayer(run)));
		expect(candidate.usage).toBeUndefined();
	});

	it.each([
		["empty content", () => completion("")],
		["not JSON", () => new Response("<html>")],
		["truncated JSON", () => new Response('{"id":"chatcmpl-1","choices":[')],
		["no body", () => new Response(null, { status: 204 })],
		["an embedded error object", () => Response.json({ error: { code: 502, message: "no host" } })],
		["filtered content", () => completion(null, "content_filter")],
	])("fails %s as a non-retryable ResponseError", async (_name, response) => {
		const { calls, run } = capture(response);
		const error = await Effect.runPromise(
			generate(clientLayer(run, { maxRetries: 2 })).pipe(Effect.flip),
		);
		expect(error).toMatchObject({
			_tag: "DiagramGenerationResponseError",
			message: "Gemini response did not include text content.",
			provider: "cloudflare-google-ai-studio",
		});
		expect(calls).toHaveLength(1);
	});
});

describe("gateway chat routes", () => {
	const haiku = { ...request, model: "anthropic/claude-haiku-5-5" };
	const anthropicLayer = (run: RunFn, policy: Partial<DiagramGenerationPolicyConfig> = {}) =>
		clientLayer(run, policy, anthropicGatewayChatRoute);

	it.each([
		["anthropic/claude-haiku-5-5", anthropicGatewayChatRoute],
		["google/gemini-3.1-flash-lite", googleGatewayChatRoute],
		["google-ai-studio/gemini-3.1-flash-lite", googleGatewayChatRoute],
		["gemini-3.1-flash-lite", googleGatewayChatRoute],
	])("routes %s by its prefix", (model, route) => {
		expect(gatewayChatRouteForModel(model)).toBe(route);
	});

	it("sends Haiku with thinking off, and no temperature or response format", async () => {
		const { calls, run } = capture();
		const candidate = await Effect.runPromise(
			generate(anthropicLayer(run), { ...haiku, temperature: 0.4 }),
		);
		const { system, user } = buildDiagramGenerationMessages(prompt);
		const [data, options] = calls[0] ?? [];
		expect(data).toEqual({
			endpoint: "v1/chat/completions",
			provider: "anthropic",
			headers: { "Content-Type": "application/json" },
			query: {
				model: "claude-haiku-5-5",
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
				max_tokens: 16_384,
				thinking: { type: "disabled" },
			},
		});
		expect(options?.gateway?.metadata?.["sketchiProvider"]).toBe("cloudflare-anthropic");
		expect(candidate).toMatchObject({
			model: "claude-haiku-5-5",
			provider: "cloudflare-anthropic",
			usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
		});
	});

	it("reports Anthropic's error body and does not retry a rejected request", async () => {
		const { calls, run } = capture(() =>
			Response.json(
				{
					error: {
						code: "invalid_request_error",
						message: "`temperature` is deprecated for this model.",
						type: "invalid_request_error",
						param: null,
					},
				},
				{ status: 400 },
			),
		);
		const error = await Effect.runPromise(
			generate(anthropicLayer(run, { maxRetries: 2 }), haiku).pipe(Effect.flip),
		);
		expect(error).toMatchObject({
			_tag: "DiagramGenerationHttpError",
			diagnostics: [
				"Anthropic Gateway request failed with HTTP 400.",
				"`temperature` is deprecated for this model.",
			],
			provider: "cloudflare-anthropic",
			retryable: false,
			status: 400,
		});
		expect(calls).toHaveLength(1);
	});

	it("retries Anthropic's overload status, then succeeds", async () => {
		const responses = [
			Response.json({ error: { message: "Overloaded" } }, { status: 529 }),
			completion(answer),
		];
		let index = 0;
		const { calls, run } = capture(() => responses[index++] ?? completion(answer));
		const candidate = await Effect.runPromise(
			generate(anthropicLayer(run, { maxRetries: 2 }), haiku),
		);
		expect(calls).toHaveLength(2);
		expect(candidate.provider).toBe("cloudflare-anthropic");
	});

	// Anthropic's chat-completions endpoint reports stop_reason max_tokens as finish_reason length.
	it("names Claude when its output stops at max_tokens", async () => {
		const { run } = capture(() => completion(answer, "length", null));
		const error = await Effect.runPromise(generate(anthropicLayer(run), haiku).pipe(Effect.flip));
		expect(error).toMatchObject({
			_tag: "DiagramGenerationLimitError",
			diagnostics: ["output_truncated: Claude stopped at the 16,384-token output limit."],
		});
	});
});

describe("gateway chat errors", () => {
	it.each([
		[408, true],
		[425, true],
		[429, true],
		[500, true],
		[503, true],
		[400, false],
		[401, false],
		[403, false],
		[404, false],
		[409, false],
		[422, false],
	])("maps HTTP %i with retryable %s and the current attempt count", async (status, retryable) => {
		const { calls, run } = capture(() =>
			Response.json({ error: { message: "upstream said no" } }, { status }),
		);
		const error = await Effect.runPromise(
			generate(clientLayer(run, { maxRetries: 2 })).pipe(Effect.flip),
		);
		expect(error).toMatchObject({
			_tag: "DiagramGenerationHttpError",
			diagnostics: [
				`Google AI Studio Gateway request failed with HTTP ${status}.`,
				"upstream said no",
			],
			provider: "cloudflare-google-ai-studio",
			raw: { error: { message: "upstream said no" } },
			retryable,
			status,
		});
		expect(calls).toHaveLength(retryable ? 3 : 1);
	});

	it("retries a quota 429 as the current client does", async () => {
		const { calls, run } = capture(() =>
			Response.json({ error: { message: "quota", type: "insufficient_quota" } }, { status: 429 }),
		);
		const error = await Effect.runPromise(
			generate(clientLayer(run, { maxRetries: 1 })).pipe(Effect.flip),
		);
		expect(error).toMatchObject({ retryable: true, status: 429 });
		expect(calls).toHaveLength(2);
		expect(calls.map(([, options]) => options?.gateway?.skipCache)).toEqual([true, true]);
	});

	it("reads Google's array-wrapped error body", async () => {
		const { run } = capture(() =>
			Response.json([{ error: { code: 404, message: "no such model", status: "NOT_FOUND" } }], {
				status: 404,
			}),
		);
		const error = await Effect.runPromise(generate(clientLayer(run)).pipe(Effect.flip));
		expect(error).toMatchObject({
			diagnostics: ["Google AI Studio Gateway request failed with HTTP 404.", "no such model"],
			raw: { error: { message: "no such model" } },
			status: 404,
		});
	});

	it("maps a binding throw to a retryable TransportError with its message", async () => {
		let calls = 0;
		const layer = clientLayer(
			async () => {
				calls += 1;
				throw new Error("binding exploded");
			},
			{ maxRetries: 1 },
		);
		const error = await Effect.runPromise(generate(layer).pipe(Effect.flip));
		expect(error).toMatchObject({
			_tag: "DiagramGenerationTransportError",
			message: "binding exploded",
			operation: "gateway.run",
			provider: "cloudflare-google-ai-studio",
			retryable: true,
		});
		expect(calls).toBe(2);
	});

	describe("when the connection breaks while reading the body", () => {
		function brokenBody(init?: ResponseInit) {
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('{"id":"chatcmpl-1",'));
						controller.error(new Error("connection reset"));
					},
				}),
				init,
			);
		}

		const expected = {
			_tag: "DiagramGenerationTransportError",
			message: "connection reset",
			operation: "gateway.run",
			provider: "cloudflare-google-ai-studio",
			retryable: true,
		};

		it.each([
			["a successful response", undefined],
			["an error response", { status: 500 }],
		])("retries when it breaks during %s", async (_name, init) => {
			const chat = capture(() => brokenBody(init));
			const error = await Effect.runPromise(
				generate(clientLayer(chat.run, { maxRetries: 2 })).pipe(Effect.flip),
			);
			expect(error).toMatchObject(expected);
			expect(chat.calls).toHaveLength(3);
		});

		it("recovers on the retry", async () => {
			let call = 0;
			const chat = capture(() => {
				call += 1;
				return call === 1 ? brokenBody() : completion(answer);
			});
			const candidate = await Effect.runPromise(generate(clientLayer(chat.run, { maxRetries: 1 })));
			expect(candidate.diagram?.type).toBe("flowchart");
			expect(chat.calls).toHaveLength(2);
		});

		it("still records the gateway log id on the failed attempt", async () => {
			const { probe, sink } = makeTelemetryTestSink();
			const logId = "01a1a910-c74c-713a-83ea-307998d588c7";
			const { run } = capture(() => brokenBody({ headers: { "cf-aig-log-id": logId } }));
			await Effect.runPromise(
				generate(clientLayer(run)).pipe(
					Effect.exit,
					Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" }, sink })),
				),
			);
			const attempt = probe.spans.find((span) => span.name.endsWith(".attempt"));
			expect(attempt).toMatchObject({
				attributes: { gateway_log_id: logId },
				error_tag: "DiagramGenerationTransportError",
			});
		});
	});

	it("reports an uninitialized gateway without an upstream attempt", async () => {
		const layer = CloudflareGatewayChatClientLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(CloudflareAiGatewayBinding, {
						gateway: () => {
							throw new Error("no gateway");
						},
					}),
					Layer.succeed(CloudflareGatewayChatConfig, {
						collectLog: true,
						gatewayId: "test",
						route: googleGatewayChatRoute,
						surface: "generate-api",
					}),
					Layer.succeed(DiagramGenerationPolicy, testPolicy),
				),
			),
		);
		const error = await Effect.runPromise(generate(layer).pipe(Effect.flip));
		expect(error).toMatchObject({ operation: "ai.gateway", retryable: false });
	});
});

describe("gateway chat cancellation", () => {
	it("aborts the gateway call when the policy times out before headers", async () => {
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

	it("keeps the signal alive during the body, then aborts on interruption", async () => {
		const reading = Promise.withResolvers<void>();
		let gatewaySignal: AbortSignal | undefined;
		const layer = clientLayer(async (_data, options) => {
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
		});
		const fiber = Effect.runFork(generate(layer));
		await reading.promise;
		expect(gatewaySignal?.aborted).toBe(false);
		await Effect.runPromise(Fiber.interrupt(fiber));
		const exit = await Effect.runPromise(Fiber.await(fiber));
		expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
		expect(gatewaySignal?.aborted).toBe(true);
	});
});

describe("gateway chat telemetry", () => {
	const PROMPT = "PROMPT-MARKER-exported-in-full";
	const traced = { ...request, prompt: { id: "scenario-1", request: PROMPT } };
	const headers = { "cf-aig-log-id": "01a1a910-c74c-713a-83ea-307998d588c7" };

	function record(layer: Layer.Layer<DiagramGenerationClient>, repeat = 1) {
		const { probe, sink } = makeTelemetryTestSink();
		return Effect.runPromise(
			Effect.flatMap(DiagramGenerationClient, (client) =>
				Effect.exit(client.generate(traced)).pipe(Effect.repeat({ times: repeat - 1 })),
			).pipe(
				Effect.provide(layer),
				Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" }, sink })),
			),
		).then(() => probe);
	}

	/** A first failure, a retry, then an unreadable answer and a repair. */
	function scripted(ok: (text: string) => Response): RunFn {
		let call = 0;
		return async () => {
			call += 1;
			if (call === 1)
				return Response.json({ error: { message: "busy" } }, { status: 503, headers });
			return ok(call === 2 ? '{"title":' : answer);
		};
	}

	type Recorded = Awaited<ReturnType<typeof record>>;
	const metrics = (recorded: Recorded) =>
		recorded.metrics.map((event) => ({
			attributes: event.attributes,
			metric: event.metric,
			value: event.metric.endsWith("duration_ms") ? "ms" : event.value,
		}));
	const logs = (recorded: Recorded) =>
		recorded.logs.map((event) => ({
			fields: event.fields,
			level: event.level,
			message: event.message,
		}));
	const spans = (recorded: Recorded) => recorded.spans;

	const policy = { maxRepairAttempts: 1, maxRetries: 1 };
	const chatEvents = () =>
		record(
			clientLayer(
				scripted((text) => completion(text, "stop", undefined, { headers })),
				policy,
			),
		);

	it("keeps the generation metrics, labels and log events", async () => {
		const events = await chatEvents();
		const provider = "cloudflare-google-ai-studio";
		const operation = "generate";
		expect(metrics(events)).toEqual([
			{ attributes: { operation, provider }, metric: "sketchi_generation_attempts", value: 1 },
			{
				attributes: { operation, provider, retry_kind: "transient" },
				metric: "sketchi_generation_retries",
				value: 1,
			},
			{ attributes: { operation, provider }, metric: "sketchi_generation_attempts", value: 1 },
			{
				attributes: { operation, outcome: "attempted", provider },
				metric: "sketchi_generation_repairs",
				value: 1,
			},
			{ attributes: { operation, provider }, metric: "sketchi_generation_attempts", value: 1 },
			{
				attributes: { operation, outcome: "succeeded", provider },
				metric: "sketchi_generation_repairs",
				value: 1,
			},
			{
				attributes: { operation, outcome: "success", provider },
				metric: "sketchi_generation_requests",
				value: 1,
			},
			{
				attributes: { operation, outcome: "success", provider },
				metric: "sketchi_generation_duration_ms",
				value: "ms",
			},
		]);
		expect(logs(events).map((log) => log.level)).toEqual(["Warn", "Warn"]);
		expect(logs(events)[0]?.message).toBe("Retrying diagram generation");
	});

	it("keeps the attempt span name and shows the repair and coverage check as spans", async () => {
		const names = spans(await chatEvents()).map((span) => span.name);
		expect(new Set(names)).toEqual(
			new Set([
				"LanguageModel.generateText",
				"diagramGeneration.coverage.check",
				"diagramGeneration.gatewayChat.attempt",
				"diagramGeneration.executeModelCall",
				"diagramGeneration.generate",
				"diagramGeneration.repair",
				"diagramGeneration.runWithPolicy",
			]),
		);
	});

	it("records the gateway log id on each attempt span that got a response", async () => {
		const attempts = spans(await chatEvents()).filter((span) => span.name.endsWith(".attempt"));
		expect(attempts).toHaveLength(3);
		for (const attempt of attempts) {
			expect(attempt.attributes["gateway_log_id"]).toBe(headers["cf-aig-log-id"]);
		}
	});

	it("records each model call's full request and response on its attempt span", async () => {
		const recorded = spans(await chatEvents());
		const attempts = recorded.filter((span) => span.name.endsWith(".attempt"));
		expect(attempts.map((span) => span.outcome)).toEqual(["failure", "success", "success"]);
		for (const attempt of attempts) {
			expect(JSON.stringify(attempt.attributes["gen_ai.system_instructions"])).toContain(
				"Response contract",
			);
			expect(JSON.stringify(attempt.attributes["gen_ai.input.messages"])).toContain(PROMPT);
			expect(attempt.attributes["gen_ai.request.model"]).toBe("gemini-3.1-flash-lite");
		}
		const [failed, invalid, answered] = attempts;
		expect(failed?.attributes["http.response.status_code"]).toBe(503);
		expect(failed?.attributes["http.response.body"]).toContain("busy");
		expect(invalid?.attributes["gen_ai.output.messages"]).toEqual([
			{ finish_reason: "stop", parts: [{ content: '{"title":', type: "text" }], role: "assistant" },
		]);
		expect(answered?.attributes).toMatchObject({
			"gen_ai.response.finish_reasons": ["stop"],
			"gen_ai.usage.input_tokens": 11,
			"gen_ai.usage.output_tokens": 7,
		});
		expect(answered?.attributes["http.response.body"]).toContain("chatcmpl-1");
		// The repair attempt asks with the invalid output and its diagnostics.
		expect(JSON.stringify(answered?.attributes["gen_ai.input.messages"])).toContain(
			'{\\"title\\":',
		);
		const repair = recorded.find((span) => span.name === "diagramGeneration.repair");
		expect(repair?.attributes["sketchi.input"]).toMatchObject({ text: '{"title":' });
		expect(repair?.attributes["sketchi.output"]).toMatchObject({ outcome: "succeeded" });
		const policy = recorded.find((span) => span.name === "diagramGeneration.runWithPolicy");
		expect(policy?.attributes["sketchi.input"]).toMatchObject({ prompt: { request: PROMPT } });
		expect(policy?.attributes["sketchi.output"]).toMatchObject({ attempts: 3 });
	});
});
