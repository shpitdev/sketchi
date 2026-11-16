import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import {
	type CloudflareAiGateway,
	makeGatewayHttpClient,
	stripAnthropicModelPrefix,
} from "@sketchi/cloudflare/ai-gateway";

import { TelemetryCorrelation } from "@sketchi/observability";
import { Array, Clock, Effect, Option, String, type Schedule } from "effect";
import { type AiError, Prompt } from "effect/ai";
import { HttpClient } from "effect/http";

import { AUTHOR_REPLY_SCHEMA, AUTHOR_SYSTEM_PROMPT } from "./author";
import { IconModelError } from "./errors";
import type { AuthorCallReply, IconAuthorModel, IconDrawGatewayConfigValue } from "./models";

/** The domain keeps tolerant reply repair; generateObject would decode before that repair. */
export const makeAuthorCall = (options: {
	readonly gateway: CloudflareAiGateway;
	readonly config: IconDrawGatewayConfigValue;
	readonly timeoutMs: number;
	readonly retry: Schedule.Schedule<unknown, IconModelError>;
	readonly transient: (status: number) => boolean;
	readonly maxTokens: number;
}) =>
	Effect.fn("iconDraw.models.author")(function* (request: {
		readonly model: IconAuthorModel;
		readonly messages: Prompt.Prompt;
	}) {
		const model = stripAnthropicModelPrefix(request.model);
		const startedAt = yield* Clock.currentTimeMillis;
		const correlation = yield* TelemetryCorrelation;
		const span = yield* Effect.option(Effect.currentSpan);
		const trace = correlation.traceId ?? Option.getOrUndefined(span)?.traceId;
		const response = yield* Effect.suspend(() => {
			// Per attempt/call, so concurrent draws cannot exchange response metadata.
			let status: number | undefined;
			const client = makeGatewayHttpClient({
				gateway: options.gateway,
				provider: "anthropic",
				headers: {
					"anthropic-version": "2023-06-01",
					"anthropic-beta": "server-side-fallback-2026-07-01",
				},
				collectLog: options.config.collectLog,
				metadata: {
					sketchiSurface: options.config.surface,
					sketchiOperation: "icon-author",
					...(trace ? { sketchiTraceId: trace } : {}),
				},
				// Public generateText config exposes effort, but not output_config.format.
				// Keep the existing domain schema without pre-empting its invalid-reply repair.
				bodyFields: {
					output_config: { format: { type: "json_schema", schema: AUTHOR_REPLY_SCHEMA } },
				},
				responseBody: "buffer",
				onResponse: (response) => {
					status = response.status;
				},
			});
			const run = Effect.gen(function* () {
				const api = yield* AnthropicClient.make({}).pipe(
					Effect.provideService(HttpClient.HttpClient, client),
				);
				const languageModel = yield* AnthropicLanguageModel.make({
					model,
					config: {
						max_tokens: options.maxTokens,
						cache_control: { type: "ephemeral" },
						thinking: { type: "adaptive" },
						output_config: { effort: options.config.authorEffort },
						fallbacks: "default",
					},
				}).pipe(Effect.provideService(AnthropicClient.AnthropicClient, api));
				return yield* languageModel.generateText({
					prompt: Prompt.concat(
						Prompt.fromMessages([
							Prompt.systemMessage({
								content: AUTHOR_SYSTEM_PROMPT,
								options: { anthropic: { cacheControl: { type: "ephemeral" } } },
							}),
						]),
						request.messages,
					),
				});
			});
			return run.pipe(
				Effect.mapError((cause: AiError.AiError) =>
					IconModelError.make({
						cause,
						model,
						role: "author",
						status,
						message:
							status !== undefined && (status < 200 || status >= 300)
								? `The author model answered HTTP ${status}: ${cause.message}`
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
							message: `The author model took longer than ${options.timeoutMs / 1000} s.`,
							model,
							role: "author",
							retryable: false,
						}),
					),
			}),
			Effect.retry(options.retry),
		);
		const finishedAt = yield* Clock.currentTimeMillis;
		const text = String.trim(response.text);
		if (response.finishReason === "content-filter" || response.finishReason === "length" || !text) {
			return yield* IconModelError.make({
				cause: response.content,
				model,
				role: "author",
				retryable: false,
				message:
					response.finishReason === "length"
						? "The author ran out of output tokens."
						: response.finishReason === "content-filter"
							? "The author declined to draw this logo."
							: "The author returned no text.",
			});
		}
		const metadata = Option.getOrUndefined(
			Array.findFirst(response.content, (part) => part.type === "response-metadata"),
		);
		const finish = Option.getOrUndefined(
			Array.findFirst(response.content, (part) => part.type === "finish"),
		);
		const usage = {
			inputTokens: response.usage.inputTokens.uncached ?? 0,
			outputTokens: response.usage.outputTokens.total ?? 0,
			cacheReadTokens: response.usage.inputTokens.cacheRead ?? 0,
			cacheWriteTokens: response.usage.inputTokens.cacheWrite ?? 0,
		};
		const logId = finish?.response?.headers["cf-aig-log-id"];
		yield* Effect.annotateCurrentSpan({
			"gen_ai.request.model": model,
			"gen_ai.response.model": metadata?.modelId ?? model,
			"gen_ai.response.finish_reasons": [response.finishReason],
			"gen_ai.usage.input_tokens": usage.inputTokens,
			"gen_ai.usage.output_tokens": usage.outputTokens,
			...(logId ? { gateway_log_id: logId } : {}),
		});
		return {
			content: Prompt.fromResponseParts(response.content),
			text,
			call: {
				role: "author",
				model: metadata?.modelId ?? model,
				usage,
				ms: finishedAt - startedAt,
			},
		} satisfies AuthorCallReply;
	});
