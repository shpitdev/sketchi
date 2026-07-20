import { Schema } from "effect";

import type {
  DiagramGenerationCacheMode,
  DiagramGenerationCandidate,
  DiagramGenerationProviderId,
  DiagramGenerationRequest,
} from "./candidates.js";
import { DiagramGenerationProviderIdSchema } from "./candidates.js";

export class DiagramGenerationConfigurationError extends Schema.TaggedErrorClass<DiagramGenerationConfigurationError>()(
  "DiagramGenerationConfigurationError",
  {
    message: Schema.String,
    provider: DiagramGenerationProviderIdSchema,
  },
) {}

export class DiagramGenerationInputError extends Schema.TaggedErrorClass<DiagramGenerationInputError>()(
  "DiagramGenerationInputError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
    provider: DiagramGenerationProviderIdSchema,
    scenarioId: Schema.String,
  },
) {}

export class DiagramGenerationTransportError extends Schema.TaggedErrorClass<DiagramGenerationTransportError>()(
  "DiagramGenerationTransportError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
    operation: Schema.String,
    provider: DiagramGenerationProviderIdSchema,
    retryable: Schema.Boolean,
  },
) {}

export class DiagramGenerationHttpError extends Schema.TaggedErrorClass<DiagramGenerationHttpError>()(
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

export class DiagramGenerationResponseError extends Schema.TaggedErrorClass<DiagramGenerationResponseError>()(
  "DiagramGenerationResponseError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
    provider: DiagramGenerationProviderIdSchema,
  },
) {}

export class DiagramGenerationTimeoutError extends Schema.TaggedErrorClass<DiagramGenerationTimeoutError>()(
  "DiagramGenerationTimeoutError",
  {
    message: Schema.String,
    provider: DiagramGenerationProviderIdSchema,
    timeoutMs: Schema.Number,
  },
) {}

export type DiagramGenerationError =
  | DiagramGenerationConfigurationError
  | DiagramGenerationHttpError
  | DiagramGenerationInputError
  | DiagramGenerationResponseError
  | DiagramGenerationTimeoutError
  | DiagramGenerationTransportError;

export function isRetryableGenerationError(
  error: DiagramGenerationError,
): boolean {
  switch (error._tag) {
    case "DiagramGenerationHttpError":
    case "DiagramGenerationTransportError":
      return error.retryable;
    case "DiagramGenerationTimeoutError":
      return true;
    case "DiagramGenerationConfigurationError":
    case "DiagramGenerationInputError":
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
      model: request.model
        .replace(/^google-ai-studio\//, "")
        .replace(/^google\//, ""),
      provider: error.provider,
      raw: error.raw,
      text: "",
    };
  }

  return baseErrorCandidate(
    error.provider,
    request.model,
    error.message,
    cacheMode,
  );
}
