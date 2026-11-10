import { CloudflareAiGatewayBinding } from "@sketchi/diagram-generation";
import type { IconRecipe } from "@sketchi/diagram-core";
import {
	AUTHOR_MAX_TOKENS,
	drawIcon,
	ICON_DRAW_MAX_ROUNDS,
	type IconAuthorModel,
	IconCatalogSvgs,
	IconDrawGatewayConfig,
	IconDrawModelsGateway,
	type IconDrawResult,
	type IconJudgeVerdict,
	type ModelCall,
	prepareIconInput,
	type AuthorTurnOutcome,
} from "@sketchi/icon-draw";
import { TelemetryCorrelation } from "@sketchi/observability";
import { Effect, Layer, Result } from "effect";

import { type GatewayAccess, httpGateway, readLogCosts, SKETCHI_GATEWAY_ID } from "./gateway.js";
import { NodeIconImaging } from "./imaging.js";

/** Studio's judge (`DEFAULT_JUDGE_MODEL` in apps/playground/src/server/icons/draw.server.ts). */
export const JUDGE_MODEL = "google/gemini-3.8-flash";

/** USD per million tokens, to estimate a draw's cost before the gateway's logs price it. */
const PRICES: Readonly<
	Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>
> = {
	"claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
	"claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};
/** Gemini Flash, rounded up: the judge's share of a draw is small. */
const JUDGE_PRICE = { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 };

function authorPrice(model: string) {
	return (
		Object.entries(PRICES).find(([name]) => model.includes(name))?.[1] ?? PRICES["claude-opus-5-5"]!
	);
}

export function estimateCallCost(call: ModelCall): number {
	const price = call.role === "judge" ? JUDGE_PRICE : authorPrice(call.model);
	return (
		(call.usage.inputTokens * price.input +
			call.usage.outputTokens * price.output +
			call.usage.cacheReadTokens * price.cacheRead +
			call.usage.cacheWriteTokens * price.cacheWrite) /
		1_000_000
	);
}

/** The author's fixed instructions and example recipes, rounded up (about 4,200 tokens measured). */
const AUTHOR_FIXED_INPUT_TOKENS = 6_000;
/** Any image the author or judge sees, rounded up: the largest, a round sheet, is about 240. */
const IMAGE_INPUT_TOKENS = 1_600;
/** A turn's request or review text. */
const TURN_TEXT_TOKENS = 1_000;
/** The judge's calls per draw (one revision is judged again), the images it sees, and its reply. */
const JUDGE_CALLS = 2;
const JUDGE_IMAGES = 6;
const JUDGE_OUTPUT_TOKENS = 2_000;

/**
 * The most one draw can cost with this author: every author call the engine
 * allows, each reading the instructions, every image so far and every earlier
 * reply at full length, all billed as cache writes, and each replying at its
 * output limit; then both judge calls. Measured draws cost a twentieth of it.
 * A provider error is retried by the engine but not billed.
 */
export function attemptCeilingUsd(author: string): number {
	const price = authorPrice(author);
	let authorUsd = 0;
	for (let call = 0; call < ICON_DRAW_MAX_ROUNDS; call += 1) {
		const input =
			AUTHOR_FIXED_INPUT_TOKENS +
			(1 + 2 * call) * IMAGE_INPUT_TOKENS +
			call * AUTHOR_MAX_TOKENS +
			TURN_TEXT_TOKENS;
		authorUsd += input * price.cacheWrite + AUTHOR_MAX_TOKENS * price.output;
	}
	const judgeUsd =
		JUDGE_CALLS *
		((JUDGE_IMAGES * IMAGE_INPUT_TOKENS + TURN_TEXT_TOKENS) * JUDGE_PRICE.input +
			JUDGE_OUTPUT_TOKENS * JUDGE_PRICE.output);
	return (authorUsd + judgeUsd) / 1_000_000;
}

export interface MarkAttempt {
	readonly author: IconAuthorModel;
	readonly startedAt: string;
	/** Drawn: a recipe came back (recognized or not). Failed: no recipe. */
	readonly outcome: "drawn" | "failed";
	readonly error?: { readonly tag: string; readonly message: string };
	readonly recipe?: IconRecipe;
	readonly judge?: IconJudgeVerdict;
	readonly rounds?: number;
	readonly accepted?: boolean;
	readonly turns?: readonly AuthorTurnOutcome[];
	readonly calls: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
	readonly ms: number;
	/** What the gateway's logs priced the attempt at; undefined while any call is unpriced. */
	readonly costUsd?: number;
	/** From token counts and list prices, for the spend stop. */
	readonly estimatedCostUsd: number;
	readonly logIds: readonly string[];
	readonly previews?: { readonly png28: string; readonly png112: string };
}

export interface DrawMarkRequest {
	readonly slug: string;
	readonly name: string;
	readonly svg: string;
	readonly author: IconAuthorModel;
	/** Tags the attempt's gateway calls, so its logs can be found together. */
	readonly traceId: string;
	readonly loadCatalogSvg: (slug: string) => Promise<string | undefined>;
	readonly budgetMs?: number;
}

/**
 * What the gateway's logs priced these calls at, or undefined while any is
 * unpriced or the logs cannot be read: a paid draw is kept either way, with its
 * log ids, so its price can be read later.
 */
export async function priceLogs(
	access: GatewayAccess,
	logIds: readonly string[],
	options?: { readonly attempts?: number; readonly waitMs?: number },
): Promise<number | undefined> {
	try {
		const costs = await readLogCosts(access, SKETCHI_GATEWAY_ID, logIds, options);
		return costs.every((entry) => entry.cost !== undefined)
			? costs.reduce((sum, entry) => sum + (entry.cost ?? 0), 0)
			: undefined;
	} catch {
		return undefined;
	}
}

/** One draw through the service's engine, with its spend read back from the gateway. */
export async function drawMark(
	access: GatewayAccess,
	request: DrawMarkRequest,
): Promise<MarkAttempt> {
	const logIds: string[] = [];
	const startedAt = new Date().toISOString();
	const started = Date.now();
	const layer = Layer.mergeAll(
		NodeIconImaging,
		Layer.succeed(IconCatalogSvgs, {
			load: (slug: string) =>
				Effect.tryPromise(() => request.loadCatalogSvg(slug)).pipe(
					Effect.orElseSucceed(() => undefined),
				),
		}),
		IconDrawModelsGateway.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(
						CloudflareAiGatewayBinding,
						httpGateway(access, (logId) => logIds.push(logId)),
					),
					Layer.succeed(IconDrawGatewayConfig, {
						gatewayId: SKETCHI_GATEWAY_ID,
						collectLog: true,
						surface: "icon-batch",
						judgeModel: JUDGE_MODEL,
						authorEffort: "low",
					}),
				),
			),
		),
	);
	let outcome:
		| Result.Result<IconDrawResult, { readonly _tag: string; readonly message: string }>
		| undefined;
	try {
		outcome = await Effect.runPromise(
			prepareIconInput({ name: request.name, svg: request.svg }).pipe(
				Effect.flatMap((input) =>
					drawIcon(input, {
						authorModel: request.author,
						...(request.budgetMs === undefined ? {} : { budgetMs: request.budgetMs }),
					}),
				),
				Effect.provide(layer),
				Effect.provideService(TelemetryCorrelation, { traceId: request.traceId }),
				Effect.result,
			),
		);
	} catch (cause) {
		outcome = Result.fail({
			_tag: "Defect",
			message: cause instanceof Error ? cause.message : String(cause),
		});
	}
	const costUsd = await priceLogs(access, logIds);
	if (Result.isFailure(outcome)) {
		const error = outcome.failure;
		return {
			author: request.author,
			startedAt,
			outcome: "failed",
			error: { tag: error._tag, message: error.message },
			calls: logIds.length,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			ms: Date.now() - started,
			...(costUsd === undefined ? {} : { costUsd }),
			// A failed draw reports no usage: until its logs are priced, count the most it could cost.
			estimatedCostUsd: costUsd ?? (logIds.length === 0 ? 0 : attemptCeilingUsd(request.author)),
			logIds,
		};
	}
	const result = outcome.success;
	return {
		author: request.author,
		startedAt,
		outcome: "drawn",
		recipe: result.recipe,
		judge: result.judge,
		rounds: result.author.rounds,
		accepted: result.author.accepted,
		turns: result.author.turns,
		calls: result.usage.calls,
		inputTokens: result.usage.inputTokens,
		outputTokens: result.usage.outputTokens,
		cacheReadTokens: result.usage.cacheReadTokens,
		cacheWriteTokens: result.usage.cacheWriteTokens,
		ms: result.usage.ms,
		...(costUsd === undefined ? {} : { costUsd }),
		estimatedCostUsd: result.usage.byCall.reduce((sum, call) => sum + estimateCallCost(call), 0),
		logIds,
		previews: result.previews,
	};
}
