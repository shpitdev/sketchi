import { CloudflareAiGatewayBinding } from "@sketchi/cloudflare/ai-gateway";

import { Array, Context, Effect, Layer, Option, Schedule, String } from "effect";

import { makeAuthorCall } from "./author-model.js";
import type { Prompt } from "effect/ai";
import { IconModelError } from "./errors.js";
import { type IconSource, svgCurveSegments } from "./input.js";
import { makeJudgeCall, stripOpenAiModelPrefix } from "./judge-model.js";

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
	const prefixed = String.startsWith("anthropic/")(model) ? model : `anthropic/${model}`;
	return Option.getOrUndefined(
		Array.findFirst(ICON_AUTHOR_MODELS, (candidate) => candidate === prefixed),
	);
}

export interface ModelUsage {
	/** Uncached input; cache reads and writes are counted separately. */
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

export interface AuthorCallReply {
	/** The assistant prompt, with provider thinking metadata for replay in the next round. */
	readonly content: Prompt.Prompt;
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
			readonly messages: Prompt.Prompt;
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

/** Output tokens one author call may spend; with the round limit, it bounds a draw's cost. */
export const AUTHOR_MAX_TOKENS = 8_192;
const AUTHOR_TIMEOUT_MS = 75_000;
const JUDGE_TIMEOUT_MS = 30_000;
/** Output tokens one judge call may spend, reasoning included; a reply needs a few hundred. */
export const JUDGE_MAX_OUTPUT_TOKENS = 1_024;

const transientRetry = Schedule.exponential(500, 2).pipe(
	Schedule.upTo({ times: 2 }),
	Schedule.setInputType<IconModelError>(),
	Schedule.while(({ input }) => input.retryable),
);

function isTransient(status: number): boolean {
	return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Author and judge calls through the Cloudflare AI Gateway, with the keys it stores. */
export const IconDrawModelsGateway = Layer.effect(IconDrawModels)(
	Effect.gen(function* () {
		const binding = yield* CloudflareAiGatewayBinding;
		const config = yield* IconDrawGatewayConfig;
		const gateway = binding.gateway(config.gatewayId);

		const author = makeAuthorCall({
			gateway,
			config,
			timeoutMs: AUTHOR_TIMEOUT_MS,
			retry: transientRetry,
			transient: isTransient,
			maxTokens: AUTHOR_MAX_TOKENS,
		});

		const judge = makeJudgeCall({
			gateway,
			config,
			timeoutMs: JUDGE_TIMEOUT_MS,
			retry: transientRetry,
			transient: isTransient,
			maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
		});

		return IconDrawModels.of({
			author,
			judge,
			judgeModel: stripOpenAiModelPrefix(config.judgeModel),
		});
	}),
);
