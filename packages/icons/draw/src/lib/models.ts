import {
	type CloudflareAiGateway,
	CloudflareAiGatewayBinding,
	stripAnthropicModelPrefix,
	stripGoogleModelPrefix,
} from "@sketchi/diagram-generation";
import { TelemetryCorrelation } from "@sketchi/observability";
import { Clock, Context, Effect, Layer, Option, Schedule } from "effect";

import { AUTHOR_REPLY_SCHEMA, AUTHOR_SYSTEM_PROMPT } from "./author.js";
import { IconModelError } from "./errors.js";
import { type IconSource, svgCurveSegments } from "./input.js";
import { JUDGE_PROMPT, JUDGE_REPLY_SCHEMA } from "./judge.js";

/** Author models a draw request may name. */
export const ICON_AUTHOR_MODELS = [
	"anthropic/claude-sonnet-5-5",
	"anthropic/claude-opus-5-5",
] as const;
export type IconAuthorModel = (typeof ICON_AUTHOR_MODELS)[number];

/**
 * Curve segments from which a mark counts as detailed. On such marks (animals,
 * faces, detailed emblems) Opus draws a closer likeness than Sonnet for about
 * the same cost, finishing in fewer rounds; on geometric marks the two draw
 * alike and Sonnet costs less.
 */
export const DETAILED_MARK_CURVES = 40;

/**
 * The author for a source when the request names none: Opus for a detailed
 * SVG and for a raster, whose outline cannot be measured; Sonnet otherwise.
 */
export function iconAuthorFor(source: IconSource): IconAuthorModel {
	return source.kind === "raster" || svgCurveSegments(source.svg) >= DETAILED_MARK_CURVES
		? "anthropic/claude-opus-5-5"
		: "anthropic/claude-sonnet-5-5";
}

export function iconAuthorModel(model: string): IconAuthorModel | undefined {
	const prefixed = model.startsWith("anthropic/") ? model : `anthropic/${model}`;
	return (ICON_AUTHOR_MODELS as readonly string[]).includes(prefixed)
		? (prefixed as IconAuthorModel)
		: undefined;
}

export interface ModelUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	/** Input read from the provider's prompt cache, billed at a tenth. */
	readonly cacheReadTokens: number;
	/** Input written to the provider's prompt cache. */
	readonly cacheWriteTokens: number;
}

export interface ModelCall {
	readonly role: "author" | "judge";
	readonly model: string;
	readonly usage: ModelUsage;
	readonly ms: number;
}

/** A Messages API content block, passed back to the provider exactly as it came. */
export type AuthorContentBlock = Readonly<Record<string, unknown>>;

export interface AuthorTurn {
	readonly role: "user" | "assistant";
	readonly content: readonly AuthorContentBlock[];
}

export interface AuthorCallReply {
	/** The assistant turn as returned, thinking blocks included, for the next round. */
	readonly content: readonly AuthorContentBlock[];
	readonly text: string;
	readonly call: ModelCall;
}

export interface JudgeCallReply {
	readonly text: string;
	readonly call: ModelCall;
}

export class IconDrawModels extends Context.Service<
	IconDrawModels,
	{
		/** One author turn: the conversation so far in, the next reply out. */
		readonly author: (request: {
			readonly model: IconAuthorModel;
			readonly messages: readonly AuthorTurn[];
		}) => Effect.Effect<AuthorCallReply, IconModelError>;
		/** One forced choice: the sketch, then the lineup, as base64 PNGs. */
		readonly judge: (request: {
			readonly sketch: string;
			readonly lineup: readonly string[];
		}) => Effect.Effect<JudgeCallReply, IconModelError>;
		readonly judgeModel: string;
	}
>()("@sketchi/icon-draw/IconDrawModels") {}

export interface IconDrawGatewayConfigValue {
	readonly gatewayId: string;
	readonly collectLog: boolean;
	readonly surface: string;
	readonly judgeModel: string;
	/** How hard the author thinks; low is enough to draw a mark and keeps rounds short. */
	readonly authorEffort: "low" | "medium" | "high";
}

export class IconDrawGatewayConfig extends Context.Service<
	IconDrawGatewayConfig,
	IconDrawGatewayConfigValue
>()("@sketchi/icon-draw/IconDrawGatewayConfig") {}

const AUTHOR_MAX_TOKENS = 8_192;
const AUTHOR_TIMEOUT_MS = 75_000;
const JUDGE_TIMEOUT_MS = 30_000;

const transientRetry = Schedule.exponential(500, 2).pipe(
	Schedule.upTo({ times: 2 }),
	Schedule.setInputType<IconModelError>(),
	Schedule.while(({ input }) => input.retryable),
);

function isTransient(status: number): boolean {
	return status === 408 || status === 425 || status === 429 || status >= 500;
}

interface GatewayReply {
	readonly status: number;
	readonly body: unknown;
	readonly logId: string | null;
}

function parse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return { text };
	}
}

function errorDetail(body: unknown): string {
	if (typeof body !== "object" || body === null) return "";
	const error = (body as { error?: unknown }).error;
	if (typeof error === "object" && error !== null && "message" in error) {
		return String(error.message);
	}
	return "";
}

/** The request's trace, so its gateway logs (cost included) can be found by it. */
const traceId = Effect.gen(function* () {
	const correlation = yield* TelemetryCorrelation;
	const span = yield* Effect.option(Effect.currentSpan);
	return correlation.traceId ?? Option.getOrUndefined(span)?.traceId;
});

function callGateway(
	gateway: CloudflareAiGateway,
	config: IconDrawGatewayConfigValue,
	role: "author" | "judge",
	model: string,
	data: { endpoint: string; provider: string; headers: Record<string, string>; query: unknown },
	timeoutMs: number,
) {
	return Effect.flatMap(traceId, (trace) =>
		Effect.tryPromise({
			try: async (signal): Promise<GatewayReply> => {
				const response = await gateway.run(data, {
					gateway: {
						collectLog: config.collectLog,
						// AI Gateway keeps five metadata entries per request.
						metadata: {
							sketchiSurface: config.surface,
							sketchiOperation: `icon-${role}`,
							...(trace ? { sketchiTraceId: trace } : {}),
						},
						skipCache: true,
					},
					signal,
				});
				return {
					status: response.status,
					body: parse(await response.text()),
					logId: response.headers.get("cf-aig-log-id"),
				};
			},
			catch: (cause) =>
				IconModelError.make({
					cause,
					message: cause instanceof Error ? cause.message : "The model request failed.",
					model,
					role,
					retryable: true,
				}),
		}),
	).pipe(
		Effect.flatMap((reply) =>
			reply.status >= 200 && reply.status < 300
				? Effect.succeed(reply)
				: Effect.fail(
						IconModelError.make({
							cause: reply.body,
							message: `The ${role} model answered HTTP ${reply.status}${errorDetail(reply.body) ? `: ${errorDetail(reply.body)}` : "."}`,
							model,
							role,
							retryable: isTransient(reply.status),
							status: reply.status,
						}),
					),
		),
		Effect.timeoutOrElse({
			duration: timeoutMs,
			orElse: () =>
				Effect.fail(
					IconModelError.make({
						cause: new Error("timeout"),
						message: `The ${role} model took longer than ${timeoutMs / 1000} s.`,
						model,
						role,
						retryable: false,
					}),
				),
		}),
		Effect.retry(transientRetry),
	);
}

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

interface MessagesReply {
	readonly content?: readonly AuthorContentBlock[];
	readonly stop_reason?: string;
	readonly model?: string;
	readonly usage?: Readonly<Record<string, unknown>>;
}

interface GenerateContentReply {
	readonly candidates?: ReadonlyArray<{
		readonly content?: {
			readonly parts?: ReadonlyArray<{ readonly text?: string; readonly thought?: boolean }>;
		};
	}>;
	readonly usageMetadata?: Readonly<Record<string, unknown>>;
}

/** Author and judge calls through the Cloudflare AI Gateway, with the keys it stores. */
export const IconDrawModelsGateway = Layer.effect(IconDrawModels)(
	Effect.gen(function* () {
		const binding = yield* CloudflareAiGatewayBinding;
		const config = yield* IconDrawGatewayConfig;
		const gateway = binding.gateway(config.gatewayId);

		const author = Effect.fn("iconDraw.models.author")(function* (request: {
			readonly model: IconAuthorModel;
			readonly messages: readonly AuthorTurn[];
		}) {
			const model = stripAnthropicModelPrefix(request.model);
			const startedAt = yield* Clock.currentTimeMillis;
			const reply = yield* callGateway(
				gateway,
				config,
				"author",
				model,
				{
					endpoint: "v1/messages",
					provider: "anthropic",
					headers: {
						"Content-Type": "application/json",
						"anthropic-version": "2023-06-01",
						"anthropic-beta": "server-side-fallback-2026-07-01",
					},
					query: {
						model,
						max_tokens: AUTHOR_MAX_TOKENS,
						// The fixed instructions and examples are cached across requests; the
						// conversation is cached across rounds.
						cache_control: { type: "ephemeral" },
						system: [
							{ type: "text", text: AUTHOR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
						],
						messages: request.messages,
						thinking: { type: "adaptive" },
						output_config: {
							effort: config.authorEffort,
							format: { type: "json_schema", schema: AUTHOR_REPLY_SCHEMA },
						},
						fallbacks: "default",
					},
				},
				AUTHOR_TIMEOUT_MS,
			);
			const finishedAt = yield* Clock.currentTimeMillis;
			const body = reply.body as MessagesReply;
			const usage: ModelUsage = {
				inputTokens: count(body.usage?.["input_tokens"]),
				outputTokens: count(body.usage?.["output_tokens"]),
				cacheReadTokens: count(body.usage?.["cache_read_input_tokens"]),
				cacheWriteTokens: count(body.usage?.["cache_creation_input_tokens"]),
			};
			yield* Effect.annotateCurrentSpan({
				"gen_ai.request.model": model,
				"gen_ai.response.model": body.model ?? model,
				"gen_ai.response.finish_reasons": [body.stop_reason],
				"gen_ai.usage.input_tokens": usage.inputTokens,
				"gen_ai.usage.output_tokens": usage.outputTokens,
				...(reply.logId ? { gateway_log_id: reply.logId } : {}),
			});
			const content = body.content ?? [];
			const text = content
				.flatMap((block) =>
					block["type"] === "text" && typeof block["text"] === "string" ? [block["text"]] : [],
				)
				.join("")
				.trim();
			if (body.stop_reason === "refusal" || body.stop_reason === "max_tokens" || !text) {
				return yield* IconModelError.make({
					cause: body,
					message:
						body.stop_reason === "max_tokens"
							? "The author ran out of output tokens."
							: body.stop_reason === "refusal"
								? "The author declined to draw this logo."
								: "The author returned no text.",
					model,
					role: "author",
					retryable: false,
				});
			}
			return {
				content,
				text,
				call: { role: "author", model: body.model ?? model, usage, ms: finishedAt - startedAt },
			} satisfies AuthorCallReply;
		});

		const judge = Effect.fn("iconDraw.models.judge")(function* (request: {
			readonly sketch: string;
			readonly lineup: readonly string[];
		}) {
			const model = stripGoogleModelPrefix(config.judgeModel);
			const startedAt = yield* Clock.currentTimeMillis;
			const image = (data: string) => ({ inline_data: { mime_type: "image/png", data } });
			const reply = yield* callGateway(
				gateway,
				config,
				"judge",
				model,
				{
					endpoint: `v1beta/models/${model}:generateContent`,
					provider: "google-ai-studio",
					headers: { "Content-Type": "application/json" },
					query: {
						contents: [
							{
								role: "user",
								parts: [
									{ text: JUDGE_PROMPT },
									{ text: "Sketch:" },
									image(request.sketch),
									...request.lineup.flatMap((logo, index) => [
										{ text: `Logo ${index + 1}:` },
										image(logo),
									]),
								],
							},
						],
						generationConfig: {
							responseMimeType: "application/json",
							responseSchema: JUDGE_REPLY_SCHEMA,
							thinkingConfig: { thinkingLevel: "low" },
							// The images are small; low resolution keeps each at a few hundred tokens.
							mediaResolution: "MEDIA_RESOLUTION_LOW",
						},
					},
				},
				JUDGE_TIMEOUT_MS,
			);
			const finishedAt = yield* Clock.currentTimeMillis;
			const body = reply.body as GenerateContentReply;
			const usage: ModelUsage = {
				inputTokens: count(body.usageMetadata?.["promptTokenCount"]),
				outputTokens:
					count(body.usageMetadata?.["candidatesTokenCount"]) +
					count(body.usageMetadata?.["thoughtsTokenCount"]),
				cacheReadTokens: count(body.usageMetadata?.["cachedContentTokenCount"]),
				cacheWriteTokens: 0,
			};
			yield* Effect.annotateCurrentSpan({
				"gen_ai.request.model": model,
				"gen_ai.usage.input_tokens": usage.inputTokens,
				"gen_ai.usage.output_tokens": usage.outputTokens,
				...(reply.logId ? { gateway_log_id: reply.logId } : {}),
			});
			const text = (body.candidates?.[0]?.content?.parts ?? [])
				.flatMap((part) => (part.thought || typeof part.text !== "string" ? [] : [part.text]))
				.join("")
				.trim();
			return {
				text,
				call: { role: "judge", model, usage, ms: finishedAt - startedAt },
			} satisfies JudgeCallReply;
		});

		return IconDrawModels.of({
			author,
			judge,
			judgeModel: stripGoogleModelPrefix(config.judgeModel),
		});
	}),
);
