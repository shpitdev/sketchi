import "@tanstack/react-start/server-only";

import {
  BuildFlowchartRequestSchema,
  MAX_FLOWCHART_BUILD_ATTEMPTS,
  type BuildFlowchartOptions,
  type BuildFlowchartResult,
  type BuildFlowchartToolInput,
  type PlaygroundCodeModePromiseRuntimeForIssue243,
} from "@sketchi/diagram-agent";

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

export interface StudioFlowchartToolExecutor {
  readonly attempts: number;
  execute(input: StudioBuildFlowchartInput): Promise<BuildFlowchartResult>;
}

/**
 * Per-agent-turn guard around the canonical runtime. Studio owns only the
 * attempt budget and artifact options; validation, quality, rendering,
 * exporting, and persistence remain the shared buildFlowchart vertical.
 */
export function createStudioFlowchartToolExecutor(
  buildFlowchart: PlaygroundCodeModePromiseRuntimeForIssue243["buildFlowchart"],
  maxAttempts = MAX_FLOWCHART_BUILD_ATTEMPTS,
): StudioFlowchartToolExecutor {
  let attempts = 0;
  let accepted: Extract<BuildFlowchartResult, { ok: true }> | undefined;
  let executionTail: Promise<void> = Promise.resolve();

  const executeNext = async (
    input: StudioBuildFlowchartInput,
  ): Promise<BuildFlowchartResult> => {
    if (accepted) {
      return accepted;
    }
    if (attempts >= maxAttempts) {
      return attemptLimitResult(maxAttempts);
    }

    attempts += 1;
    const result = await buildFlowchart({
      ...input,
      options: STUDIO_FLOWCHART_ARTIFACT_OPTIONS,
    });
    if (result.ok) {
      accepted = result;
    }
    return result;
  };

  return {
    get attempts() {
      return attempts;
    },
    execute(input) {
      const result = executionTail.then(() => executeNext(input));
      executionTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
