import { recordMetric, withTelemetryCorrelation } from "@sketchi/observability";
import { Clock, Effect, Metric, Ref, Schedule } from "effect";

import type {
  DiagramGenerationCandidate,
  DiagramGenerationProviderId,
  DiagramGenerationRequest,
} from "./candidates.js";
import type { DiagramGenerationPolicyConfig } from "./client.js";
import {
  type DiagramGenerationError,
  DiagramGenerationTimeoutError,
  isRetryableGenerationError,
} from "./errors.js";

const generationAttempts = Metric.counter("sketchi_generation_attempts", {
  description: "Diagram generation upstream attempts",
  incremental: true,
});
const generationRequests = Metric.counter("sketchi_generation_requests", {
  description: "Diagram generation requests by terminal outcome",
  incremental: true,
});
const generationRetries = Metric.counter("sketchi_generation_retries", {
  description: "Diagram generation retry attempts",
  incremental: true,
});
const generationFailures = Metric.counter("sketchi_generation_failures", {
  description: "Diagram generation terminal failures",
  incremental: true,
});
const generationTimeouts = Metric.counter("sketchi_generation_timeouts", {
  description: "Diagram generation upstream timeouts",
  incremental: true,
});
const generationDuration = Metric.histogram("sketchi_generation_duration_ms", {
  description: "Diagram generation request duration in milliseconds",
  boundaries: Metric.boundariesFromIterable([
    50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000,
  ]),
});

export const runDiagramGenerationWithPolicy = Effect.fn(
  "diagramGeneration.runWithPolicy",
)(function* (
  prepareAttempt: Effect.Effect<
    Effect.Effect<DiagramGenerationCandidate, DiagramGenerationError>,
    DiagramGenerationError
  >,
  request: DiagramGenerationRequest,
  provider: DiagramGenerationProviderId,
  policy: DiagramGenerationPolicyConfig,
) {
  const startedAt = yield* Clock.currentTimeMillis;
  const operation = Effect.gen(function* () {
    const attempt = yield* prepareAttempt;
    const attemptRef = yield* Ref.make(0);
    const previousErrorTagRef = yield* Ref.make("initial");
    const measuredAttempt = Effect.gen(function* () {
      const attemptNumber = yield* Ref.updateAndGet(
        attemptRef,
        (value) => value + 1,
      );
      yield* recordMetric(generationAttempts, 1, {
        operation: "generate",
        provider,
      });
      if (attemptNumber > 1) {
        const previousErrorTag = yield* Ref.get(previousErrorTagRef);
        yield* recordMetric(generationRetries, 1, {
          operation: "generate",
          provider,
          retryKind: "transient",
        });
        yield* Effect.logWarning("Retrying diagram generation", {
          attempt: attemptNumber,
          error_tag: previousErrorTag,
          operation: "generate",
          provider,
          retry_kind: "transient",
        });
      }
      return yield* attempt.pipe(
        Effect.annotateSpans({ attempt: attemptNumber }),
        Effect.timeoutOrElse({
          duration: policy.requestTimeoutMs,
          orElse: () =>
            Effect.fail(
              DiagramGenerationTimeoutError.make({
                message: `Generation timed out after ${policy.requestTimeoutMs} ms.`,
                provider,
                timeoutMs: policy.requestTimeoutMs,
              }),
            ),
        }),
        Effect.tapError((error) => Ref.set(previousErrorTagRef, error._tag)),
      );
    });
    const candidate = yield* measuredAttempt.pipe(
      Effect.retry({
        schedule: Schedule.exponential(policy.retryDelayMs),
        times: policy.maxRetries,
        while: isRetryableGenerationError,
      }),
    );
    const finishedAt = yield* Clock.currentTimeMillis;
    return {
      ...candidate,
      durationMs: Math.round(finishedAt - startedAt),
    };
  }).pipe(
    Effect.tap((candidate) =>
      Effect.all([
        recordMetric(generationRequests, 1, {
          operation: "generate",
          outcome: "success",
          provider,
        }),
        recordMetric(generationDuration, candidate.durationMs, {
          operation: "generate",
          outcome: "success",
          provider,
        }),
      ]),
    ),
    Effect.tapError((error) =>
      Effect.gen(function* () {
        const finishedAt = yield* Clock.currentTimeMillis;
        const durationMs = Math.max(0, finishedAt - startedAt);
        yield* recordMetric(generationRequests, 1, {
          failureCategory: error._tag,
          operation: "generate",
          outcome: "failure",
          provider,
        });
        yield* recordMetric(generationFailures, 1, {
          failureCategory: error._tag,
          operation: "generate",
          provider,
        });
        yield* recordMetric(generationDuration, durationMs, {
          failureCategory: error._tag,
          operation: "generate",
          outcome: "failure",
          provider,
        });
        if (error._tag === "DiagramGenerationTimeoutError") {
          yield* recordMetric(generationTimeouts, 1, {
            operation: "generate",
            provider,
            timeoutKind: "upstream",
          });
        }
      }),
    ),
  );

  return yield* withTelemetryCorrelation(operation, {
    scenarioId: request.prompt.id,
  });
});
