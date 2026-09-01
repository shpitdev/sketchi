import { recordMetric, withTelemetryCorrelation } from "@sketchi/observability";
import { Clock, Effect, Metric, Ref, Result, Schedule } from "effect";

import {
  type DiagramGenerationCandidate,
  type DiagramGenerationProviderId,
  type DiagramGenerationRequest,
  explicitRequestMinimums,
} from "./candidates.js";
import type { DiagramGenerationPolicyConfig } from "./client.js";
import {
  type DiagramGenerationError,
  DiagramGenerationTimeoutError,
  generationErrorToCandidate,
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
const generationRepairs = Metric.counter("sketchi_generation_repairs", {
  description: "Diagram generation semantic repair attempts by outcome",
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
  prepareAttempt: (
    request: DiagramGenerationRequest,
  ) => Effect.Effect<
    Effect.Effect<DiagramGenerationCandidate, DiagramGenerationError>,
    DiagramGenerationError
  >,
  request: DiagramGenerationRequest,
  provider: DiagramGenerationProviderId,
  policy: DiagramGenerationPolicyConfig,
) {
  const startedAt = yield* Clock.currentTimeMillis;
  const executeModelCall = Effect.fn("diagramGeneration.executeModelCall")(
    function* (callRequest: DiagramGenerationRequest) {
      const attempt = yield* prepareAttempt(callRequest);
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
      return yield* measuredAttempt.pipe(
        Effect.retry({
          schedule: Schedule.exponential(policy.retryDelayMs),
          times: policy.maxRetries,
          while: isRetryableGenerationError,
        }),
      );
    },
  );

  const operation = Effect.gen(function* () {
    const originalCandidate = yield* executeModelCall(request);
    let latestCandidate = originalCandidate;
    let candidate = originalCandidate;
    let diagnostics = [...originalCandidate.diagnostics];
    for (
      let repairAttempt = 1;
      repairAttempt <= policy.maxRepairAttempts && !latestCandidate.diagram;
      repairAttempt += 1
    ) {
      const truncated = latestCandidate.diagnostics.some((diagnostic) =>
        diagnostic.startsWith("output_truncated:"),
      );
      yield* recordMetric(generationRepairs, 1, {
        operation: "generate",
        outcome: "attempted",
        provider,
      });
      yield* Effect.logWarning("Repairing invalid diagram generation", {
        operation: "generate",
        provider,
        repair_attempt: repairAttempt,
        repair_kind: truncated ? "regenerate_truncated" : "repair_invalid",
      });
      const repairRequest = truncated
        ? { ...request, cacheMode: "fresh" as const }
        : buildRepairRequest(
            request,
            { ...latestCandidate, diagnostics },
            repairAttempt,
          );
      const attemptedDiagnostic = `repair_attempted: ${truncated ? "regenerated a truncated response" : "requested a corrected response"} (attempt ${repairAttempt}).`;
      const repairResult = yield* Effect.result(
        executeModelCall(repairRequest),
      );
      if (Result.isFailure(repairResult)) {
        const failedRepairCandidate = generationErrorToCandidate(
          repairResult.failure,
          repairRequest,
        );
        diagnostics = [
          ...diagnostics,
          attemptedDiagnostic,
          ...failedRepairCandidate.diagnostics,
          `repair_failed: semantic repair attempt ${repairAttempt} failed.`,
        ];
        yield* recordMetric(generationRepairs, 1, {
          operation: "generate",
          outcome: "failed",
          provider,
        });
        candidate = { ...originalCandidate, diagnostics };
        break;
      }
      const repaired = repairResult.success;
      const outcome = repaired.diagram ? "succeeded" : "failed";
      yield* recordMetric(generationRepairs, 1, {
        operation: "generate",
        outcome,
        provider,
      });
      diagnostics = [
        ...diagnostics,
        attemptedDiagnostic,
        ...repaired.diagnostics,
        `repair_${outcome}: semantic repair attempt ${repairAttempt} ${outcome}.`,
      ];
      latestCandidate = repaired;
      candidate = repaired.diagram
        ? { ...repaired, diagnostics }
        : { ...originalCandidate, diagnostics };
    }
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
          outcome: candidate.diagram ? "success" : "invalid",
          provider,
        }),
        recordMetric(generationDuration, candidate.durationMs, {
          operation: "generate",
          outcome: candidate.diagram ? "success" : "invalid",
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

function buildRepairRequest(
  request: DiagramGenerationRequest,
  candidate: DiagramGenerationCandidate,
  repairAttempt: number,
): DiagramGenerationRequest {
  const priorityDiagnostics = candidate.diagnostics.filter(
    (diagnostic) =>
      diagnostic.startsWith("flowchart.start_has_incoming:") ||
      diagnostic.startsWith("flowchart.self_loop:"),
  );
  const priorityCorrections = [
    ...(priorityDiagnostics.some((diagnostic) =>
      diagnostic.startsWith("flowchart.start_has_incoming:"),
    )
      ? [
          "Required correction for start-node incoming edges: reroute each offending loop-back edge to the first process node after start. Never target the start node; start nodes have no incoming edges.",
        ]
      : []),
    ...(priorityDiagnostics.some((diagnostic) =>
      diagnostic.startsWith("flowchart.self_loop:"),
    )
      ? [
          "Required correction for self-loops: reroute each offending edge to an earlier distinct process or decision node. Never keep the same node as both source and target; model every retry or re-check as a decision branch returning to that earlier distinct node.",
        ]
      : []),
  ];
  const priorityGuidance =
    priorityDiagnostics.length > 0
      ? [
          "Priority validator issue and hint:",
          ...priorityDiagnostics.map((diagnostic) => `- ${diagnostic}`),
          ...priorityCorrections,
          "",
        ]
      : [];
  const parsedMinimums = explicitRequestMinimums(
    request.prompt.request,
    request.prompt.type,
  );
  const originalHardRequirements = [
    "Original hard requirements (all remain mandatory):",
    `- Diagram type: ${request.prompt.type}.`,
    `- Original scenario: ${request.prompt.request}`,
    ...parsedMinimums.map(
      (minimum) =>
        `- Parsed minimum: at least ${minimum.expectedCount} ${minimum.expectedUnit} (from the original request for at least ${minimum.requestedCount} ${minimum.requestedUnit}).`,
    ),
    ...request.prompt.requiredNodeLabels.map(
      (label) => `- Required node label: ${label}`,
    ),
    ...request.prompt.requiredBranchLabels.map(
      (label) => `- Required decision branch label: ${label}`,
    ),
    "",
  ];
  return {
    ...request,
    cacheMode: "fresh",
    prompt: {
      ...request.prompt,
      request: [
        request.prompt.request,
        "",
        `Repair attempt ${repairAttempt}: return a complete corrected diagram that satisfies every validator diagnostic below.`,
        "PRESERVE all existing nodes and labels except the minimal edit needed to fix the listed issues. Do not compact, summarize, remove, combine, rename, or relabel unaffected content.",
        "",
        ...originalHardRequirements,
        ...priorityGuidance,
        "Invalid model output:",
        candidate.text,
        "",
        "Validator diagnostics:",
        ...candidate.diagnostics.map((diagnostic) => `- ${diagnostic}`),
      ].join("\n"),
    },
  };
}
