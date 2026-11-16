import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { type CloudflareAiGateway } from "@sketchi/cloudflare/ai-gateway";

import { TelemetryCorrelation } from "@sketchi/observability";
import { Array, Clock, Effect, Option, Schema, String, type Schedule } from "effect";
import { type AiError, Prompt } from "effect/ai";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

import { IconModelError } from "./errors.js";
import { JUDGE_PROMPT } from "./judge.js";
import type { IconDrawGatewayConfigValue, JudgeCallReply } from "./models.js";

const JudgeReply = Schema.Struct({ logo: Schema.Int });
const decodeQuery = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** The bare model id for an OpenAI route, without its gateway routing prefix. */
export function stripOpenAiModelPrefix(model: string): string {
	return String.replace(/^openai\//, "")(model);
}

/** One forced choice over OpenAI's Responses API, through the gateway's stored key. */
export const makeJudgeCall = (options: {
	readonly gateway: CloudflareAiGateway;
	readonly config: IconDrawGatewayConfigValue;
	readonly timeoutMs: number;
	readonly retry: Schedule.Schedule<unknown, IconModelError>;
	readonly transient: (status: number) => boolean;
	readonly maxOutputTokens: number;
}) =>
	Effect.fn("iconDraw.models.judge")(function* (request: {
		readonly sketch: string;
		readonly lineup: readonly string[];
	}) {
		const model = stripOpenAiModelPrefix(options.config.judgeModel);
		const startedAt = yield* Clock.currentTimeMillis;
		const correlation = yield* TelemetryCorrelation;
		const span = yield* Effect.option(Effect.currentSpan);
		const trace = correlation.traceId ?? Option.getOrUndefined(span)?.traceId;
		const image = (data: string) =>
			Prompt.filePart({
				mediaType: "image/png",
				data,
				options: { openai: { imageDetail: "low" } },
			});
		const prompt = Prompt.make([
			{
				role: "user",
				content: [
					Prompt.textPart({ text: JUDGE_PROMPT }),
					Prompt.textPart({ text: "Sketch:" }),
					image(request.sketch),
					...Array.flatMap(request.lineup, (logo, index) => [
						Prompt.textPart({ text: `Logo ${index + 1}:` }),
						image(logo),
					]),
				],
			},
		]);
		const reply = yield* Effect.suspend(() => {
			// Per attempt/call, so concurrent draws cannot exchange response metadata.
			let status: number | undefined;
			let logId: string | undefined;
			const client = HttpClient.make(
				Effect.fn("iconDraw.models.judge.gateway")(function* (httpRequest, url, signal) {
					if (signal.aborted) return yield* Effect.interrupt;
					if (httpRequest.body._tag !== "Uint8Array") {
						return yield* Effect.fail(
							new HttpClientError.HttpClientError({
								reason: new HttpClientError.EncodeError({
									request: httpRequest,
									description: "Expected an OpenAI JSON request.",
								}),
							}),
						);
					}
					const query = yield* decodeQuery(
						httpRequest.body.text ?? new TextDecoder().decode(httpRequest.body.body),
					).pipe(
						Effect.mapError(
							(cause) =>
								new HttpClientError.HttpClientError({
									reason: new HttpClientError.EncodeError({ request: httpRequest, cause }),
								}),
						),
					);
					const transportError = (cause: unknown) =>
						new HttpClientError.HttpClientError({
							reason: new HttpClientError.TransportError({ request: httpRequest, cause }),
						});
					const response = yield* Effect.tryPromise({
						try: () =>
							options.gateway.run(
								{
									endpoint: String.replace(/^\//, "")(url.pathname),
									provider: "openai",
									headers: { "Content-Type": "application/json" },
									query,
								},
								{
									gateway: {
										collectLog: options.config.collectLog,
										skipCache: true,
										metadata: {
											sketchiSurface: options.config.surface,
											sketchiOperation: "icon-judge",
											...(trace ? { sketchiTraceId: trace } : {}),
										},
									},
									signal,
								},
							),
						catch: transportError,
					});
					status = response.status;
					logId = response.headers.get("cf-aig-log-id") ?? undefined;
					// A broken body remains a retryable transport error, within the same abortable attempt.
					const body = yield* Effect.tryPromise({
						try: () => response.text(),
						catch: transportError,
					});
					return HttpClientResponse.fromWeb(
						httpRequest,
						new Response(body, { status: response.status, headers: response.headers }),
					);
				}),
			);
			const run = Effect.gen(function* () {
				const api = yield* OpenAiClient.make({ apiUrl: "https://gateway.invalid" }).pipe(
					Effect.provideService(HttpClient.HttpClient, client),
				);
				const languageModel = yield* OpenAiLanguageModel.make({
					model,
					config: {
						store: false,
						reasoning: { effort: "low" },
						max_output_tokens: options.maxOutputTokens,
					},
				}).pipe(Effect.provideService(OpenAiClient.OpenAiClient, api));
				return yield* languageModel.generateObject({
					prompt,
					schema: JudgeReply,
					objectName: "judge_reply",
				});
			});
			return run.pipe(
				Effect.map((response) => ({ response, logId })),
				Effect.catchIf(
					// An answer that is not a logo number is no verdict, not a failed call.
					(cause: AiError.AiError) =>
						(cause.reason._tag === "StructuredOutputError" ||
							cause.reason._tag === "InvalidOutputError") &&
						status !== undefined &&
						status >= 200 &&
						status < 300,
					() => Effect.succeed({ response: undefined, logId }),
				),
				Effect.mapError((cause: AiError.AiError) =>
					IconModelError.make({
						cause,
						model,
						role: "judge",
						status,
						message:
							status !== undefined && (status < 200 || status >= 300)
								? `The judge model answered HTTP ${status}: ${cause.message}`
								: cause.message,
						retryable:
							status !== undefined && (status < 200 || status >= 300)
								? options.transient(status)
								: cause.reason._tag === "NetworkError",
					}),
				),
			);
		}).pipe(
			Effect.timeoutOrElse({
				duration: options.timeoutMs,
				orElse: () =>
					Effect.fail(
						IconModelError.make({
							cause: new Error("timeout"),
							model,
							role: "judge",
							retryable: false,
							message: `The judge model took longer than ${options.timeoutMs / 1000} s.`,
						}),
					),
			}),
			Effect.retry(options.retry),
		);
		const usage = {
			inputTokens: reply.response?.usage.inputTokens.uncached ?? 0,
			outputTokens: reply.response?.usage.outputTokens.total ?? 0,
			cacheReadTokens: reply.response?.usage.inputTokens.cacheRead ?? 0,
			cacheWriteTokens: reply.response?.usage.inputTokens.cacheWrite ?? 0,
		};
		yield* Effect.annotateCurrentSpan({
			"gen_ai.request.model": model,
			"gen_ai.usage.input_tokens": usage.inputTokens,
			"gen_ai.usage.output_tokens": usage.outputTokens,
			...(reply.logId ? { gateway_log_id: reply.logId } : {}),
		});
		const finishedAt = yield* Clock.currentTimeMillis;
		return {
			text: String.trim(reply.response?.text ?? ""),
			call: { role: "judge", model, usage, ms: finishedAt - startedAt },
		} satisfies JudgeCallReply;
	});
