import {
	ApiError,
	GoogleGenAI,
	MediaResolution,
	ThinkingLevel,
	type HttpOptions,
} from "@google/genai/node";
import { type CloudflareAiGateway, stripGoogleModelPrefix } from "@sketchi/cloudflare/ai-gateway";

import { TelemetryCorrelation } from "@sketchi/observability";
import {
	Array,
	Clock,
	Effect,
	Option,
	Ref,
	Schema,
	String,
	type Schedule,
	type Scope,
} from "effect";
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http";
import { PassThroughClient } from "google-auth-library";

import { IconModelError } from "./errors.js";
import { JUDGE_PROMPT, JUDGE_REPLY_SCHEMA } from "./judge.js";
import type { IconDrawGatewayConfigValue, JudgeCallReply } from "./models.js";

const decodeQuery = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
interface ResponseInfo {
	readonly status: number;
	readonly logId: string | null;
}

/** SDK owns GenerateContent; the request scope owns its stored-key gateway transport and body. */
export const makeJudgeCall = (options: {
	readonly gateway: CloudflareAiGateway;
	readonly config: IconDrawGatewayConfigValue;
	readonly timeoutMs: number;
	readonly retry: Schedule.Schedule<unknown, IconModelError>;
	readonly transient: (status: number) => boolean;
}) =>
	Effect.gen(function* () {
		// Lazy and shared within this layer, with no request binding/context in the SDK client.
		// Public PassThroughClient prevents ADC; the SDK's two missing-key warnings remain visible.
		const api = yield* Effect.cached(
			Effect.sync(
				() =>
					new GoogleGenAI({
						vertexai: false,
						googleAuthOptions: { authClient: new PassThroughClient() },
						httpOptions: {
							apiVersion: "v1beta",
							baseUrl: "https://binding.invalid",
							retryOptions: { attempts: 1 },
							fetch: () => {
								throw new Error("The judge requires its request-owned gateway transport.");
							},
						},
					}),
			),
		);
		return Effect.fn("iconDraw.models.judge")(function* (request: {
			readonly sketch: string;
			readonly lineup: readonly string[];
		}) {
			const model = stripGoogleModelPrefix(options.config.judgeModel);
			const startedAt = yield* Clock.currentTimeMillis;
			const correlation = yield* TelemetryCorrelation;
			const span = yield* Effect.option(Effect.currentSpan);
			const trace = correlation.traceId ?? Option.getOrUndefined(span)?.traceId;
			const sdk = yield* api;
			const reply = yield* Effect.scoped(
				Effect.gen(function* () {
					// Only for SDK parse-before-ApiError: never share status across attempts/calls.
					const info = yield* Ref.make<ResponseInfo | undefined>(undefined);
					const client = HttpClient.withScope(
						HttpClient.make(
							Effect.fn("iconDraw.models.judge.gateway")(function* (httpRequest, _url, signal) {
								if (signal.aborted) return yield* Effect.interrupt;
								if (httpRequest.body._tag !== "Uint8Array") {
									return yield* Effect.fail(
										new HttpClientError.HttpClientError({
											reason: new HttpClientError.EncodeError({ request: httpRequest }),
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
								const response = yield* Effect.tryPromise({
									try: () =>
										options.gateway.run(
											{
												endpoint: `v1beta/models/${model}:generateContent`,
												provider: "google-ai-studio",
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
									catch: (cause) =>
										new HttpClientError.HttpClientError({
											reason: new HttpClientError.TransportError({ request: httpRequest, cause }),
										}),
								});
								yield* Ref.set(info, {
									status: response.status,
									logId: response.headers.get("cf-aig-log-id"),
								});
								return HttpClientResponse.fromWeb(httpRequest, response);
							}),
						),
					);
					const context = yield* Effect.context<Scope.Scope>();
					const fetch: HttpOptions = {
						fetch: (input, init) => {
							const send = Effect.gen(function* () {
								if (typeof init?.body !== "string") {
									return yield* Effect.fail(
										IconModelError.make({
											cause: new Error("Expected an SDK JSON request."),
											message: "Expected an SDK JSON request.",
											model,
											role: "judge",
											retryable: false,
										}),
									);
								}
								const url =
									typeof input === "string"
										? input
										: input instanceof Request
											? input.url
											: input.href;
								const response = yield* client.execute(
									HttpClientRequest.bodyText(
										HttpClientRequest.post(url),
										init.body,
										"application/json",
									),
								);
								return Option.getOrThrow(HttpClientResponse.toWeb(response));
							});
							// Public SDK Promise host callback: re-enter only this captured request scope.
							return Effect.runPromiseWith(context)(send, { signal: init?.signal ?? undefined });
						},
						retryOptions: { attempts: 1 },
					};
					const image = (data: string) => ({ inlineData: { mimeType: "image/png", data } });
					const result = yield* Effect.result(
						Effect.tryPromise({
							try: (signal) =>
								sdk.models.generateContent({
									model,
									contents: [
										{
											role: "user",
											parts: [
												{ text: JUDGE_PROMPT },
												{ text: "Sketch:" },
												image(request.sketch),
												...Array.flatMap(request.lineup, (logo, index) => [
													{ text: `Logo ${index + 1}:` },
													image(logo),
												]),
											],
										},
									],
									config: {
										responseMimeType: "application/json",
										responseSchema: JUDGE_REPLY_SCHEMA,
										thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
										mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
										abortSignal: signal,
										httpOptions: fetch,
									},
								}),
							catch: (cause) =>
								IconModelError.make({
									cause,
									model,
									role: "judge",
									retryable: true,
									message: cause instanceof Error ? cause.message : "The model request failed.",
								}),
						}),
					);
					const received = yield* Ref.get(info);
					if (result._tag === "Failure") {
						if (
							result.failure.cause instanceof SyntaxError &&
							received !== undefined &&
							received.status >= 200 &&
							received.status < 300
						) {
							return { response: undefined, logId: received.logId };
						}
						// A failed body read is still a transport failure, even after error headers.
						// Only the SDK's typed HTTP error or its demonstrated JSON parse gap owns a status.
						const status =
							result.failure.cause instanceof ApiError
								? result.failure.cause.status
								: result.failure.cause instanceof SyntaxError
									? received?.status
									: undefined;
						return yield* Effect.fail(
							IconModelError.make({
								cause: result.failure.cause,
								model,
								role: "judge",
								status,
								message:
									status !== undefined && (status < 200 || status >= 300)
										? `The judge model answered HTTP ${status}: ${result.failure.message}`
										: result.failure.message,
								retryable:
									status !== undefined && (status < 200 || status >= 300)
										? options.transient(status)
										: true,
							}),
						);
					}
					return { response: result.success, logId: received?.logId };
				}),
			).pipe(
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
			// Google promptTokenCount includes cached input; ModelUsage keeps it separate.
			const cacheReadTokens = reply.response?.usageMetadata?.cachedContentTokenCount ?? 0;
			const usage = {
				inputTokens: (reply.response?.usageMetadata?.promptTokenCount ?? 0) - cacheReadTokens,
				outputTokens:
					(reply.response?.usageMetadata?.candidatesTokenCount ?? 0) +
					(reply.response?.usageMetadata?.thoughtsTokenCount ?? 0),
				cacheReadTokens,
				cacheWriteTokens: 0,
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
	});
