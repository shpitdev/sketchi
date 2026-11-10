import { CloudflareAiGatewayBinding } from "@sketchi/diagram-generation";
import type { IconRecipe } from "@sketchi/diagram-core";
import {
	drawIcon,
	type IconAuthorModel,
	IconCatalogSvgs,
	IconDrawGatewayConfig,
	IconDrawModelsGateway,
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

export function estimateCallCost(call: ModelCall): number {
	const price =
		call.role === "judge"
			? JUDGE_PRICE
			: (Object.entries(PRICES).find(([model]) => call.model.includes(model))?.[1] ??
				PRICES["claude-opus-5-5"]!);
	return (
		(call.usage.inputTokens * price.input +
			call.usage.outputTokens * price.output +
			call.usage.cacheReadTokens * price.cacheRead +
			call.usage.cacheWriteTokens * price.cacheWrite) /
		1_000_000
	);
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
	const outcome = await Effect.runPromise(
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
	const costs = await readLogCosts(access, SKETCHI_GATEWAY_ID, logIds);
	const priced = costs.every((entry) => entry.cost !== undefined);
	const costUsd = priced ? costs.reduce((sum, entry) => sum + (entry.cost ?? 0), 0) : undefined;
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
			// A failed draw reports no usage; its logs are the only measure.
			estimatedCostUsd: costUsd ?? 0,
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
