import "@tanstack/react-start/server-only";

import {
  BuildFlowchartRequestSchema,
  MAX_FLOWCHART_BUILD_ATTEMPTS,
  type BuildFlowchartOptions,
  type BuildFlowchartResult,
  type BuildFlowchartToolInput,
} from "@sketchi/diagram-agent";
import { Effect, Ref, Semaphore } from "effect";

export const STUDIO_BUILD_FLOWCHART_TOOL_NAME: "build_flowchart" =
  "build_flowchart";

export const STUDIO_BUILD_FLOWCHART_TOOL_DESCRIPTION =
  "Build and persist one canonical flowchart artifact. Pass { spec: FlowchartSpec }; the host supplies artifact options. If rejected, repair every structured issue and retry, up to three total attempts.";

export const StudioBuildFlowchartInputSchema = BuildFlowchartRequestSchema.omit(
  { options: true },
);

export type StudioBuildFlowchartInput = BuildFlowchartToolInput;

export const STUDIO_FLOWCHART_ARTIFACT_OPTIONS: NonNullable<BuildFlowchartOptions> =
  {
    artifactFormats: ["scene", "excalidraw"],
    inlineArtifacts: ["scene"],
  };

function attemptLimitResult(maxAttempts: number): BuildFlowchartResult {
  return {
    ok: false,
    status: "quality_failed",
    issues: [
      {
        code: "quality_below_threshold",
        severity: "error",
        stage: "quality",
        ref: { kind: "request", path: "spec" },
        message: `Flowchart was not accepted within ${maxAttempts} attempts.`,
        hint: "Stop calling build_flowchart this turn and summarize the remaining structured issues for the user.",
      },
    ],
  };
}

export interface StudioFlowchartToolExecutor<E = never, R = never> {
  readonly attempts: Effect.Effect<number>;
  readonly execute: (
    input: StudioBuildFlowchartInput,
  ) => Effect.Effect<BuildFlowchartResult, E, R>;
}

/**
 * Per-agent-turn guard around the canonical runtime. Studio owns only the
 * attempt budget and artifact options; validation, quality, rendering,
 * exporting, and persistence remain the shared buildFlowchart vertical.
 */
export function makeStudioFlowchartToolExecutor<E, R>(
  buildFlowchart: (input: unknown) => Effect.Effect<BuildFlowchartResult, E, R>,
  maxAttempts = MAX_FLOWCHART_BUILD_ATTEMPTS,
): Effect.Effect<StudioFlowchartToolExecutor<E, R>> {
  return Effect.gen(function* () {
    const semaphore = yield* Semaphore.make(1);
    const state = yield* Ref.make<{
      attempts: number;
      accepted?: Extract<BuildFlowchartResult, { ok: true }>;
    }>({ attempts: 0 });

    const execute = Effect.fn("playground.chat.buildFlowchart.execute")(
      (input: StudioBuildFlowchartInput) =>
        semaphore.withPermit(
          Effect.gen(function* () {
            const current = yield* Ref.get(state);
            if (current.accepted) {
              return current.accepted;
            }
            if (current.attempts >= maxAttempts) {
              return attemptLimitResult(maxAttempts);
            }

            yield* Ref.update(state, (value) => ({
              ...value,
              attempts: value.attempts + 1,
            }));
            const result = yield* buildFlowchart({
              ...input,
              options: STUDIO_FLOWCHART_ARTIFACT_OPTIONS,
            });
            if (result.ok) {
              yield* Ref.update(state, (value) => ({
                ...value,
                accepted: result,
              }));
            }
            return result;
          }),
        ),
    );

    return {
      attempts: Ref.get(state).pipe(Effect.map((value) => value.attempts)),
      execute,
    };
  });
}
