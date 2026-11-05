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
	CloudflareGatewayChatClientLive,
	CloudflareGatewayChatConfig,
	googleGatewayChatRoute,
} from "./cloudflare-gateway-chat.js";
import { buildDiagramGenerationMessages } from "./messages.js";

type RunArgs = Parameters<CloudflareAiGateway["run"]>;
type RunFn = (...args: RunArgs) => Promise<Response>;

const unsupported = JSON.stringify({
	title: "Unsupported",
	intent: { requestedKind: "architecture", nativeKind: null, requirements: [] },
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
};

function bindingLayer(run: RunFn) {
	return Layer.succeed(CloudflareAiGatewayBinding, {
		gateway: () => ({ run, getUrl: () => Promise.resolve("https://gateway.invalid") }),
	});
}

function clientLayer(run: RunFn, policy: Partial<DiagramGenerationPolicyConfig> = {}) {
	return CloudflareGatewayChatClientLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				bindingLayer(run),
				Layer.succeed(CloudflareGatewayChatConfig, {
					collectLog: true,
					gatewayId: "test",
					route: googleGatewayChatRoute,
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
	cacheMode?: "default" | "fresh";
	maxOutputTokens?: number;
	temperature?: number;
};

function generate(layer: ReturnType<typeof clientLayer>, input: GenerationInput = request) {
	return Effect.flatMap(DiagramGenerationClient, (client) => client.generate(input)).pipe(
		Effect.provide(layer),
	);
}

function capture(response: () => Response = () => completion(unsupported)) {
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
				cacheMode: "fresh",
				maxOutputTokens: 123,
				temperature: 0.4,
			}),
		);
		const { system, user } = buildDiagramGenerationMessages(prompt);
		const [data, options] = calls[0] ?? [];
		expect(data).toEqual({
			endpoint: "v1beta/openai/chat/completions",
			provider: "google-ai-studio",
			headers: {
				"Content-Type": "application/json",
				"Cache-Control": "no-store",
				"cf-aig-skip-cache": "true",
				Pragma: "no-cache",
			},
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
		expect(options?.signal).toBeInstanceOf(AbortSignal);
		expect(candidate).toMatchObject({
			cacheMode: "fresh",
			model: "gemini-3.1-flash-lite",
			provider: "cloudflare-google-ai-studio",
			usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
		});
		expect(candidate.intent?.nativeKind).toBeNull();
	});

	it("defaults max tokens and temperature, and sends no cache headers", async () => {
		const { calls, run } = capture();
		await Effect.runPromise(generate(clientLayer(run)));
		expect(calls[0]?.[0].headers).toEqual({ "Content-Type": "application/json" });
		expect(calls[0]?.[0].query).toMatchObject({ max_tokens: 16_384, temperature: 0.1 });
	});

	it("joins gateway logs to the request through at most five metadata entries", async () => {
		const { calls, run } = capture();
		await Effect.runPromise(
			withTelemetryCorrelation(generate(clientLayer(run)), { traceId: "trace_abc" }),
		);
		const metadata = calls[0]?.[1]?.gateway?.metadata;
		expect(metadata).toEqual({
			cacheMode: "default",
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
	it("flags truncation in the current wording and regenerates fresh through the policy", async () => {
		let call = 0;
		const calls: RunArgs[] = [];
		const layer = clientLayer(
			async (...args) => {
				calls.push(args);
				call += 1;
				return call === 1 ? completion('{"title":', "length") : completion(unsupported);
			},
			{ maxRepairAttempts: 1 },
		);
		const candidate = await Effect.runPromise(generate(layer));
		expect(calls).toHaveLength(2);
		expect(calls[1]?.[0].headers["cf-aig-skip-cache"]).toBe("true");
		expect(candidate.diagnostics).toContain(
			"output_truncated: Gemini stopped at the maximum output-token budget; regenerate the complete diagram.",
		);
		expect(candidate.diagnostics.join("\n")).toContain("repair_succeeded");
	});

	it("reports truncation without repair as the current client does", async () => {
		const { run } = capture(() => completion('{"title":', "length"));
		const candidate = await Effect.runPromise(generate(clientLayer(run)));
		expect(candidate.error).toBe("Gemini output was truncated.");
	});

	it("omits usage when the upstream sends none", async () => {
		const { run } = capture(() => completion(unsupported, "stop", null));
		const candidate = await Effect.runPromise(generate(clientLayer(run)));
		expect(candidate.usage).toBeUndefined();
	});

	it.each([
		["empty content", () => completion("")],
		["empty content at the token limit", () => completion(null, "length")],
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
				return call === 1 ? brokenBody() : completion(unsupported);
			});
			const candidate = await Effect.runPromise(generate(clientLayer(chat.run, { maxRetries: 1 })));
			expect(candidate.intent?.nativeKind).toBeNull();
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
			const attempt = probe.events.find(
				(event) => event.event === "effect.span" && event.name.endsWith(".attempt"),
			);
			expect(attempt).toMatchObject({
				attributes: { gateway_log_id: logId },
				error_category: "DiagramGenerationTransportError",
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
	const SECRET_PROMPT = "PROMPT-MARKER-do-not-export";
	const traced = { ...request, prompt: { id: "scenario-1", request: SECRET_PROMPT } };
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
		).then(() => probe.events);
	}

	/** A first failure, a retry, then a truncated answer and a repair. */
	function scripted(ok: (text: string, truncated: boolean) => Response): RunFn {
		let call = 0;
		return async () => {
			call += 1;
			if (call === 1)
				return Response.json({ error: { message: "busy" } }, { status: 503, headers });
			return call === 2 ? ok('{"title":', true) : ok(unsupported, false);
		};
	}

	const metrics = (events: Awaited<ReturnType<typeof record>>) =>
		events.flatMap((event) =>
			event.event === "effect.metric"
				? [
						{
							attributes: event.attributes,
							metric: event.metric,
							value: event.metric.endsWith("duration_ms") ? "ms" : event.value,
						},
					]
				: [],
		);
	const logs = (events: Awaited<ReturnType<typeof record>>) =>
		events.flatMap((event) =>
			event.event === "effect.log"
				? [{ fields: event.fields, level: event.level, message: event.message }]
				: [],
		);
	const spans = (events: Awaited<ReturnType<typeof record>>) =>
		events.flatMap((event) => (event.event === "effect.span" ? [event] : []));

	const policy = { maxRepairAttempts: 1, maxRetries: 1 };
	const chatEvents = () =>
		record(
			clientLayer(
				scripted((text, truncated) =>
					completion(text, truncated ? "length" : "stop", undefined, { headers }),
				),
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

	it("keeps the attempt span name and adds only the language model span", async () => {
		const names = spans(await chatEvents()).map((span) => span.name);
		expect(new Set(names)).toEqual(
			new Set([
				"LanguageModel.generateText",
				"diagramGeneration.cloudflareGoogleAiStudio.attempt",
				"diagramGeneration.executeModelCall",
				"diagramGeneration.generate",
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

	it("exports no prompt or response text", async () => {
		const exported = JSON.stringify(await chatEvents());
		expect(exported).not.toContain(SECRET_PROMPT);
		expect(exported).not.toContain("Response contract");
		expect(exported).not.toContain("Unsupported");
	});
});
