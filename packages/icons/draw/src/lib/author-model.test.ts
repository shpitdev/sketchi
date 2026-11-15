import { describe, expect, it } from "@effect/vitest";
import {
	CloudflareAiGatewayBinding,
	type CloudflareAiGateway,
} from "@sketchi/cloudflare/ai-gateway";
import { TelemetryCorrelation } from "@sketchi/observability";
import { Cause, Effect, Exit, Fiber, Latch, Layer } from "effect";
import { Prompt } from "effect/ai";
import { TestClock } from "effect/testing";

import { AUTHOR_REPLY_SCHEMA, AUTHOR_SYSTEM_PROMPT, decodeAuthorReply } from "./author.js";
import { IconDrawGatewayConfig, IconDrawModels, IconDrawModelsGateway } from "./models.js";

const wireReply = (overrides: Record<string, unknown> = {}) => ({
	id: "msg_fixture",
	type: "message",
	role: "assistant",
	model: "claude-sonnet-5-5",
	content: [{ type: "text", text: '{"accept":true,"recipe":null}' }],
	stop_reason: "end_turn",
	stop_sequence: null,
	usage: {
		input_tokens: 4,
		output_tokens: 16,
		cache_read_input_tokens: 4005,
		cache_creation_input_tokens: 737,
	},
	...overrides,
});
const prompt = Prompt.make([
	{
		role: "user",
		content: [
			Prompt.filePart({ mediaType: "image/png", data: "aW1hZ2U=" }),
			Prompt.textPart({ text: "Draw Acme" }),
		],
	},
]);
const config = {
	gatewayId: "google-ai-studio",
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
		Effect.provideService(TelemetryCorrelation, { traceId: "6c1c0000000000000000000000000001" }),
	);
const author = Effect.gen(function* () {
	const models = yield* IconDrawModels;
	return yield* models.author({ model: "anthropic/claude-sonnet-5-5", messages: prompt });
});

describe("icon author provider boundary", () => {
	it.effect(
		"replays signed and redacted thinking through provider metadata while preserving cache controls and uncached usage",
		() =>
			Effect.gen(function* () {
				const calls: Parameters<CloudflareAiGateway["run"]>[] = [];
				const reply = wireReply({
					content: [
						{ type: "thinking", thinking: "Check the silhouette.", signature: "opaque-signature" },
						{ type: "redacted_thinking", data: "opaque-redacted" },
						{ type: "text", text: '{"accept":true,"recipe":null}' },
					],
				});
				const responses = yield* withGateway(
					Effect.gen(function* () {
						const models = yield* IconDrawModels;
						const first = yield* models.author({
							model: "anthropic/claude-sonnet-5-5",
							messages: prompt,
						});
						const second = yield* models.author({
							model: "anthropic/claude-sonnet-5-5",
							messages: Prompt.concat(
								Prompt.concat(prompt, first.content),
								Prompt.make("Review it"),
							),
						});
						return { first, second };
					}),
					async (...args) => {
						calls.push(args);
						return Response.json(reply, { headers: { "cf-aig-log-id": "gateway-fixture" } });
					},
				);
				expect(responses.first.call.usage).toEqual({
					inputTokens: 4,
					outputTokens: 16,
					cacheReadTokens: 4005,
					cacheWriteTokens: 737,
				});
				expect(responses.second.text).toBe('{"accept":true,"recipe":null}');
				expect(calls[0]?.[0]).toMatchObject({
					endpoint: "v1/messages",
					provider: "anthropic",
					headers: { "anthropic-beta": "server-side-fallback-2026-07-01" },
					query: {
						model: "claude-sonnet-5-5",
						max_tokens: 8192,
						thinking: { type: "adaptive" },
						fallbacks: "default",
						cache_control: { type: "ephemeral" },
						system: [
							{ type: "text", text: AUTHOR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
						],
						output_config: {
							effort: "low",
							format: { type: "json_schema", schema: AUTHOR_REPLY_SCHEMA },
						},
					},
				});
				expect(calls[1]?.[0].query).toMatchObject({
					messages: [
						{
							role: "user",
							content: [
								{
									type: "image",
									source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" },
								},
								{ type: "text", text: "Draw Acme" },
							],
						},
						{ role: "assistant", content: reply.content },
						{ role: "user", content: [{ type: "text", text: "Review it" }] },
					],
				});
				expect(calls[0]?.[1]?.gateway).toEqual({
					collectLog: true,
					skipCache: true,
					metadata: {
						sketchiSurface: "studio",
						sketchiOperation: "icon-author",
						sketchiTraceId: "6c1c0000000000000000000000000001",
					},
				});
			}),
	);

	it.effect("leaves invalid author text for the existing domain repair", () =>
		Effect.gen(function* () {
			const reply = yield* withGateway(author, () =>
				Promise.resolve(
					Response.json(wireReply({ content: [{ type: "text", text: "broken JSON" }] })),
				),
			);
			expect(reply.text).toBe("broken JSON");
			expect(decodeAuthorReply(reply.text)).toBeUndefined();
		}),
	);

	it.effect("keeps refusal and output-limit errors terminal", () =>
		Effect.gen(function* () {
			for (const [stop_reason, message] of [
				["refusal", "The author declined to draw this logo."],
				["max_tokens", "The author ran out of output tokens."],
			] as const) {
				let calls = 0;
				const error = yield* withGateway(Effect.flip(author), () => {
					calls++;
					return Promise.resolve(Response.json(wireReply({ stop_reason })));
				});
				expect(error).toMatchObject({ _tag: "IconModelError", message, retryable: false });
				expect(calls).toBe(1);
			}
		}),
	);

	it.effect(
		"retries the existing transient statuses and keeps permanent HTTP failures terminal",
		() =>
			Effect.gen(function* () {
				for (const status of [408, 425, 429, 500, 400]) {
					let calls = 0;
					const started = yield* Latch.make();
					const fiber = yield* withGateway(Effect.result(author), () => {
						calls++;
						Latch.openUnsafe(started);
						return Promise.resolve(
							calls === 1
								? Response.json({ error: { message: "busy" } }, { status })
								: Response.json(wireReply()),
						);
					}).pipe(Effect.forkChild);
					yield* started.await;
					yield* TestClock.adjust(500);
					const result = yield* Fiber.join(fiber);
					expect(result._tag).toBe(status === 400 ? "Failure" : "Success");
					expect(calls).toBe(status === 400 ? 1 : 2);
				}
			}),
	);

	it.effect("bounds repeated transient failures to the existing two retries", () =>
		Effect.gen(function* () {
			let calls = 0;
			const started = yield* Latch.make();
			const fiber = yield* withGateway(Effect.flip(author), () => {
				calls++;
				Latch.openUnsafe(started);
				return Promise.resolve(Response.json({ error: { message: "capacity" } }, { status: 503 }));
			}).pipe(Effect.forkChild);
			yield* started.await;
			yield* TestClock.adjust(1500);
			const error = yield* Fiber.join(fiber);
			expect(error).toMatchObject({ _tag: "IconModelError", status: 503, retryable: true });
			expect(calls).toBe(3);
		}),
	);

	it.effect("preserves transport causes and retries broken response bodies", () =>
		Effect.gen(function* () {
			const failure = Object.assign(new Error("gateway connection lost"), {
				requestId: "sdk-fixture",
			});
			const started = yield* Latch.make();
			let calls = 0;
			const fiber = yield* withGateway(Effect.flip(author), () => {
				calls++;
				Latch.openUnsafe(started);
				return Promise.reject(failure);
			}).pipe(Effect.forkChild);
			yield* started.await;
			yield* TestClock.adjust(1500);
			const error = yield* Fiber.join(fiber);
			expect(calls).toBe(3);
			expect(error.cause).toMatchObject({
				reason: { _tag: "NetworkError", cause: { reason: { cause: failure } } },
			});
			const reading = yield* Latch.make();
			let reads = 0;
			const bodyFiber = yield* withGateway(author, () => {
				reads++;
				Latch.openUnsafe(reading);
				return Promise.resolve(
					reads === 1
						? new Response(
								new ReadableStream({
									start(controller) {
										controller.error(failure);
									},
								}),
							)
						: Response.json(wireReply()),
				);
			}).pipe(Effect.forkChild);
			yield* reading.await;
			yield* TestClock.adjust(500);
			const reply = yield* Fiber.join(bodyFiber);
			expect(reads).toBe(2);
			expect(reply.text).toContain("accept");
		}),
	);

	it.effect(
		"aborts the gateway signal on interruption and on the existing per-attempt deadline",
		() =>
			Effect.gen(function* () {
				for (const timeout of [false, true]) {
					const started = yield* Latch.make();
					const pending = Promise.withResolvers<Response>();
					let signal: AbortSignal | undefined;
					let calls = 0;
					const fiber = yield* withGateway(Effect.result(author), (_data, options) => {
						calls++;
						signal = options?.signal;
						Latch.openUnsafe(started);
						return pending.promise;
					}).pipe(Effect.forkChild);
					yield* started.await;
					if (timeout) {
						yield* TestClock.adjust(75000);
						const result = yield* Fiber.join(fiber);
						expect(result).toMatchObject({
							_tag: "Failure",
							failure: { message: "The author model took longer than 75 s.", retryable: false },
						});
					} else {
						yield* Fiber.interrupt(fiber);
						const exit = yield* Fiber.await(fiber);
						expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
					}
					expect(signal?.aborted).toBe(true);
					expect(calls).toBe(1);
					pending.resolve(Response.json(wireReply()));
				}
			}),
	);
});
