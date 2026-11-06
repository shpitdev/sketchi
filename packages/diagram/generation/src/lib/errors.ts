import { Schema } from "effect";
import { stripGoogleModelPrefix } from "./models.js";

import type {
	DiagramGenerationCacheMode,
	DiagramGenerationCandidate,
	DiagramGenerationProviderId,
	DiagramGenerationRequest,
} from "./candidates.js";
import { DiagramGenerationProviderIdSchema } from "./candidates.js";

export class DiagramGenerationConfigurationError extends Schema.TaggedError<DiagramGenerationConfigurationError>()(
	"DiagramGenerationConfigurationError",
	{
		message: Schema.String,
		provider: DiagramGenerationProviderIdSchema,
	},
) {}

export class DiagramGenerationInputError extends Schema.TaggedError<DiagramGenerationInputError>()(
	"DiagramGenerationInputError",
	{
		cause: Schema.Defect(),
		message: Schema.String,
		provider: DiagramGenerationProviderIdSchema,
		scenarioId: Schema.String,
	},
) {}

export class DiagramGenerationTransportError extends Schema.TaggedError<DiagramGenerationTransportError>()(
	"DiagramGenerationTransportError",
	{
		cause: Schema.Defect(),
		message: Schema.String,
		operation: Schema.String,
		provider: DiagramGenerationProviderIdSchema,
		retryable: Schema.Boolean,
	},
) {}

export class DiagramGenerationHttpError extends Schema.TaggedError<DiagramGenerationHttpError>()(
	"DiagramGenerationHttpError",
	{
		diagnostics: Schema.Array(Schema.String),
		durationMs: Schema.Number,
		provider: DiagramGenerationProviderIdSchema,
		raw: Schema.Unknown,
		retryable: Schema.Boolean,
		status: Schema.Number,
	},
) {}

export class DiagramGenerationResponseError extends Schema.TaggedError<DiagramGenerationResponseError>()(
	"DiagramGenerationResponseError",
	{
		cause: Schema.Defect(),
		message: Schema.String,
		provider: DiagramGenerationProviderIdSchema,
	},
) {}

export class DiagramGenerationTimeoutError extends Schema.TaggedError<DiagramGenerationTimeoutError>()(
	"DiagramGenerationTimeoutError",
	{
		message: Schema.String,
		provider: DiagramGenerationProviderIdSchema,
		/** One model call, retried while time remains, or the whole request, which ends it. */
		scope: Schema.Literals(["attempt", "request"]),
		timeoutMs: Schema.Number,
	},
) {}

/** The request needs more than Sketchi draws or than one answer may hold. */
export class DiagramGenerationLimitError extends Schema.TaggedError<DiagramGenerationLimitError>()(
	"DiagramGenerationLimitError",
	{
		diagnostics: Schema.Array(Schema.String),
		/** `output_tokens`: the answer reached the output budget. `diagram_size`: a family limit. */
		limit: Schema.Literals(["output_tokens", "diagram_size"]),
		message: Schema.String,
		provider: DiagramGenerationProviderIdSchema,
	},
) {}

export type DiagramGenerationError =
	| DiagramGenerationConfigurationError
	| DiagramGenerationHttpError
	| DiagramGenerationInputError
	| DiagramGenerationLimitError
	| DiagramGenerationResponseError
	| DiagramGenerationTimeoutError
	| DiagramGenerationTransportError;

export function isRetryableGenerationError(error: DiagramGenerationError): boolean {
	switch (error._tag) {
		case "DiagramGenerationHttpError":
		case "DiagramGenerationTransportError":
			return error.retryable;
		case "DiagramGenerationTimeoutError":
			return error.scope === "attempt";
		case "DiagramGenerationConfigurationError":
		case "DiagramGenerationInputError":
		case "DiagramGenerationLimitError":
		case "DiagramGenerationResponseError":
			return false;
	}
}

export function errorMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error ? cause.message : fallback;
}

function baseErrorCandidate(
	provider: DiagramGenerationProviderId,
	model: string,
	message: string,
	cacheMode: DiagramGenerationCacheMode,
): DiagramGenerationCandidate {
	return {
		cacheMode,
		diagnostics: [message],
		error: message,
		model,
		provider,
		text: "",
	};
}

export function generationErrorToCandidate(
	error: DiagramGenerationError,
	request: Pick<DiagramGenerationRequest, "cacheMode" | "model">,
): DiagramGenerationCandidate {
	const cacheMode = request.cacheMode ?? "default";

	if (error._tag === "DiagramGenerationHttpError") {
		return {
			cacheMode,
			diagnostics: [...error.diagnostics],
			durationMs: error.durationMs,
			error: `HTTP ${error.status}`,
			model: stripGoogleModelPrefix(request.model),
			provider: error.provider,
			raw: error.raw,
			text: "",
		};
	}

	if (error._tag === "DiagramGenerationLimitError") {
		return {
			...baseErrorCandidate(
				error.provider,
				stripGoogleModelPrefix(request.model),
				error.message,
				cacheMode,
			),
			diagnostics: [error.message, ...error.diagnostics],
		};
	}

	return baseErrorCandidate(
		error.provider,
		stripGoogleModelPrefix(request.model),
		error.message,
		cacheMode,
	);
}
