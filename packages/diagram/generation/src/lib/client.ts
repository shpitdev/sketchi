import { Context, type Effect, Layer } from "effect";

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

export interface DiagramGenerationPolicyConfig {
  readonly concurrency: number;
  readonly maxRetries: number;
  readonly requestTimeoutMs: number;
  readonly retryDelayMs: number;
}

export class DiagramGenerationPolicy extends Context.Service<
  DiagramGenerationPolicy,
  DiagramGenerationPolicyConfig
>()("@sketchi/diagram-generation/DiagramGenerationPolicy") {}

export const diagramGenerationPolicyDefaults: DiagramGenerationPolicyConfig = {
  concurrency: 2,
  maxRetries: 2,
  requestTimeoutMs: 30_000,
  retryDelayMs: 250,
};

export const DiagramGenerationPolicyLive = Layer.succeed(
  DiagramGenerationPolicy,
  diagramGenerationPolicyDefaults,
);
