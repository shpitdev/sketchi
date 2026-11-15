import { describe, expect, it } from "@effect/vitest";
import { CloudflareAiGatewayBinding, type CloudflareAiGateway } from "@sketchi/diagram-generation";
import { TelemetryCorrelation } from "@sketchi/observability";
import { Effect, Fiber, Latch, Layer } from "effect";
import { TestClock } from "effect/testing";

import { JUDGE_PROMPT, JUDGE_REPLY_SCHEMA } from "./judge.js";
import { IconDrawGatewayConfig, IconDrawModels, IconDrawModelsGateway } from "./models.js";

const wire = () => ({
	candidates: [
		{
			content: {
				parts: [{ text: "hidden", thought: true }, { text: '  {"logo":' }, { text: "2}  " }],
			},
		},
	],
	usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 7, thoughtsTokenCount: 11 },
});
const config = {
	gatewayId: "stored-key",
	collectLog: true,
	surface: "studio",
	judgeModel: "google/gemini-3.8-flash",
	authorEffort: "low",
} as const;
const withGateway = <A, E, R>(
	effect: Effect.Effect<A, E, R | IconDrawModels>,
	run: CloudflareAiGateway["run"],
) =>
	effect.pipe(
		Effect.provide(
			IconDrawModelsGateway.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(CloudflareAiGatewayBinding, {
							gateway: () => ({ run, getUrl: () => Promise.resolve("https://gateway.invalid") }),
						}),
						Layer.succeed(IconDrawGatewayConfig, config),
					),
				),
			),
		),
		Effect.provideService(TelemetryCorrelation, { traceId: "judge-trace" }),
	);
const judge = Effect.gen(function* () {
	return yield* (yield* IconDrawModels).judge({
		sketch: "sketch-png",
		lineup: ["first-png", "second-png"],
	});
});

describe("Google judge SDK boundary", () => {
	it.effect(
		"preserves native controls, image order, first-candidate text, thinking usage and gateway metadata",
		() =>
			Effect.gen(function* () {
				const calls: Parameters<CloudflareAiGateway["run"]>[] = [];
				const reply = yield* withGateway(judge, async (...args) => {
					calls.push(args);
					return Response.json(wire(), { headers: { "cf-aig-log-id": "judge-log" } });
				});
				expect(reply).toMatchObject({
					text: '{"logo":2}',
					call: {
						role: "judge",
						model: "gemini-3.8-flash",
						usage: { inputTokens: 100, outputTokens: 18, cacheReadTokens: 0, cacheWriteTokens: 0 },
					},
				});
				expect(calls[0]?.[0]).toEqual({
					endpoint: "v1beta/models/gemini-3.8-flash:generateContent",
					provider: "google-ai-studio",
					headers: { "Content-Type": "application/json" },
					query: {
						contents: [
							{
								role: "user",
								parts: [
									{ text: JUDGE_PROMPT },
									{ text: "Sketch:" },
									{ inlineData: { mimeType: "image/png", data: "sketch-png" } },
									{ text: "Logo 1:" },
									{ inlineData: { mimeType: "image/png", data: "first-png" } },
									{ text: "Logo 2:" },
									{ inlineData: { mimeType: "image/png", data: "second-png" } },
								],
							},
						],
						generationConfig: {
							responseMimeType: "application/json",
							responseSchema: JUDGE_REPLY_SCHEMA,
							thinkingConfig: { thinkingLevel: "LOW" },
							mediaResolution: "MEDIA_RESOLUTION_LOW",
						},
					},
				});
				expect(calls[0]?.[1]?.gateway).toEqual({
					collectLog: true,
					skipCache: true,
					metadata: {
						sketchiSurface: "studio",
						sketchiOperation: "icon-judge",
						sketchiTraceId: "judge-trace",
					},
				});
				expect(calls).toHaveLength(1);
			}),
	);
	it.effect(
		"preserves empty and malformed successful replies as no-pick without transport retries",
		() =>
			Effect.gen(function* () {
				for (const body of ["{}", "", "not JSON"]) {
					let calls = 0;
					const reply = yield* withGateway(judge, () => {
						calls++;
						return Promise.resolve(
							new Response(body, { headers: { "content-type": "application/json" } }),
						);
					});
					expect(reply.text).toBe("");
					expect(reply.call.usage).toEqual({
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
					});
					expect(calls).toBe(1);
				}
			}),
	);
	it.effect("preserves HTTP classification even when SDK JSON parsing loses the status", () =>
		Effect.gen(function* () {
			for (const [status, malformed] of [
				[400, false],
				[400, true],
				[408, false],
				[425, false],
				[429, false],
				[500, true],
				[503, false],
			] as const) {
				let calls = 0;
				const started = yield* Latch.make();
				const fiber = yield* withGateway(Effect.result(judge), () => {
					calls++;
					Latch.openUnsafe(started);
					return Promise.resolve(
						calls === 1
							? new Response(malformed ? "not JSON" : '{"error":{"message":"busy"}}', {
									status,
									headers: { "content-type": "application/json" },
								})
							: Response.json(wire()),
					);
				}).pipe(Effect.forkChild);
				yield* started.await;
				yield* TestClock.adjust(500);
				const result = yield* Fiber.join(fiber);
				expect(result._tag).toBe(status === 400 ? "Failure" : "Success");
				expect(calls).toBe(status === 400 ? 1 : 2);
				if (result._tag === "Failure")
					expect(result.failure).toMatchObject({
						_tag: "IconModelError",
						status: 400,
						retryable: false,
						message: expect.stringContaining("HTTP 400"),
					});
			}
		}),
	);
	it.effect(
		"bounds repeated transient failures to two outer retries, with one SDK attempt each",
		() =>
			Effect.gen(function* () {
				let calls = 0;
				const started = yield* Latch.make();
				const fiber = yield* withGateway(Effect.flip(judge), () => {
					calls++;
					Latch.openUnsafe(started);
					return Promise.resolve(
						Response.json({ error: { message: "capacity" } }, { status: 503 }),
					);
				}).pipe(Effect.forkChild);
				yield* started.await;
				yield* TestClock.adjust(1500);
				const error = yield* Fiber.join(fiber);
				expect(calls).toBe(3);
				expect(error).toMatchObject({
					status: 503,
					retryable: true,
					cause: expect.objectContaining({ name: "ApiError" }),
				});
			}),
	);
	it.effect("retries a broken response stream rather than converting it to no-pick", () =>
		Effect.gen(function* () {
			for (const status of [200, 400]) {
				let calls = 0;
				const entered = yield* Latch.make();
				const fiber = yield* withGateway(judge, () => {
					calls++;
					Latch.openUnsafe(entered);
					return Promise.resolve(
						calls === 1
							? new Response(
									new ReadableStream({
										start(controller) {
											controller.error(new Error("body disconnected"));
										},
									}),
									{ status, headers: { "content-type": "application/json" } },
								)
							: Response.json(wire()),
					);
				}).pipe(Effect.forkChild);
				yield* entered.await;
				yield* TestClock.adjust(500);
				expect((yield* Fiber.join(fiber)).text).toBe('{"logo":2}');
				expect(calls).toBe(2);
			}
		}),
	);
	it.effect(
		"aborts pending headers and response bodies on interruption and the existing 30s deadline",
		() =>
			Effect.gen(function* () {
				for (const body of [false, true])
					for (const timeout of [false, true]) {
						const entered = yield* Latch.make();
						const aborted = yield* Latch.make();
						const fiber = yield* withGateway(
							Effect.result(judge),
							(_data, options) =>
								new Promise<Response>((resolve, reject) => {
									const cancel = () => {
										Latch.openUnsafe(aborted);
										reject(new DOMException("aborted", "AbortError"));
									};
									if (body) {
										const pending = Promise.withResolvers<void>();
										const stream = new ReadableStream(
											{
												start(controller) {
													options?.signal?.addEventListener(
														"abort",
														() => {
															controller.error(new DOMException("aborted", "AbortError"));
															pending.resolve();
															Latch.openUnsafe(aborted);
														},
														{ once: true },
													);
												},
												pull() {
													Latch.openUnsafe(entered);
													return pending.promise;
												},
											},
											{ highWaterMark: 0 },
										);
										resolve(new Response(stream));
									} else {
										options?.signal?.addEventListener("abort", cancel, { once: true });
										Latch.openUnsafe(entered);
									}
								}),
						).pipe(Effect.forkChild);
						yield* entered.await;
						if (timeout) {
							yield* TestClock.adjust(30000);
							const result = yield* Fiber.join(fiber);
							expect(result._tag).toBe("Failure");
							if (result._tag === "Failure")
								expect(result.failure).toMatchObject({
									retryable: false,
									message: "The judge model took longer than 30 s.",
								});
						} else yield* Fiber.interrupt(fiber);
						yield* aborted.await;
					}
			}),
	);
});
