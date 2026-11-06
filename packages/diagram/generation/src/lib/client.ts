import { Context, type Effect, Layer, Schema } from "effect";

import type {
	DiagramGenerationCandidate,
	DiagramGenerationProviderId,
	DiagramGenerationRequest,
} from "./candidates.js";
import type { DiagramGenerationError } from "./errors.js";

export class DiagramGenerationClient extends Context.Service<
	DiagramGenerationClient,
	{
		readonly generate: (
			request: DiagramGenerationRequest,
		) => Effect.Effect<DiagramGenerationCandidate, DiagramGenerationError>;
		readonly provider: DiagramGenerationProviderId;
	}
>()("@sketchi/diagram-generation/DiagramGenerationClient") {}

export class DiagramGenerationPolicyConfig extends Schema.Class<DiagramGenerationPolicyConfig>(
	"DiagramGenerationPolicyConfig",
)({
	concurrency: Schema.Number,
	maxRepairAttempts: Schema.Number,
	maxRetries: Schema.Number,
	/** One model call, which must have time to write the whole output budget. */
	requestTimeoutMs: Schema.Number,
	retryDelayMs: Schema.Number,
	/** Every call, retry and repair for one request. Callers wait for this long. */
	totalTimeoutMs: Schema.Number,
}) {}

export class DiagramGenerationPolicy extends Context.Service<
	DiagramGenerationPolicy,
	DiagramGenerationPolicyConfig
>()("@sketchi/diagram-generation/DiagramGenerationPolicy") {}

/**
 * Claude Haiku 5.5 through AI Gateway writes about 385 output tokens a second
 * after under a second to the first token, streaming or not: 13,165 tokens in
 * 34.5 s, 23,035 in 59.5 s, 29,615 in 76.5 s and 32,907 in 84.9 s.
 */
export const MEASURED_OUTPUT_TOKENS_PER_SECOND = 385;

export const diagramGenerationPolicyDefaults: DiagramGenerationPolicyConfig = {
	concurrency: 2,
	maxRepairAttempts: 2,
	maxRetries: 2,
	// A full output budget takes about 43 s; the rest covers a slow first token.
	requestTimeoutMs: 55_000,
	retryDelayMs: 250,
	// Room for two full-budget calls, an answer and its repair, and inside the
	// CLI's wait with time left to build and return the diagram.
	totalTimeoutMs: 120_000,
};

export const DiagramGenerationPolicyLive = Layer.succeed(
	DiagramGenerationPolicy,
	diagramGenerationPolicyDefaults,
);
