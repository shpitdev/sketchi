import { Output, stepCountIs, ToolLoopAgent } from "ai";
import { hashString, logEventSafely } from "../../convex/lib/observability";
import { createOpenRouterChatModel } from "../ai/openrouter";
import { IntermediateFormatSchema } from "../diagram-intermediate";
import { createValidateIntermediateTool } from "./intermediate-validation";
import { getProfile } from "./profile-registry";
import type { GenerateIntermediateResult } from "./types";

export interface GenerateOptions {
  profileId?: string;
  /**
   * Correlation id for logs/tracing across systems.
   * If not provided, a new UUID is generated.
   */
  traceId?: string;
}

type IntermediateGenerationFailureReason =
  | "AI_NO_OUTPUT"
  | "AI_PARSE_ERROR"
  | "AI_TIMEOUT"
  | "AI_PROVIDER_ERROR"
  | "AI_VALIDATION_FAILED"
  | "UNKNOWN";

interface IntermediateGenerationAttemptFailure {
  errorMessage?: string;
  errorName?: string;
  modelId: string;
  reason: IntermediateGenerationFailureReason;
}

function classifyIntermediateErrorReason(
  error: unknown
): IntermediateGenerationFailureReason {
  if (!(error instanceof Error)) {
    return "UNKNOWN";
  }

  const msg = error.message.toLowerCase();
  if (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("aborted")
  ) {
    return "AI_TIMEOUT";
  }
  if (msg.includes("no output generated")) {
    return "AI_NO_OUTPUT";
  }
  if (msg.includes("failed to process successful response")) {
    return "AI_PARSE_ERROR";
  }
  if (msg.includes("provider returned error")) {
    return "AI_PROVIDER_ERROR";
  }
  if (msg.includes("validation failed after")) {
    return "AI_VALIDATION_FAILED";
  }
  return "UNKNOWN";
}

function isRetryableIntermediateReason(
  reason: IntermediateGenerationFailureReason
): boolean {
  return (
    reason === "AI_NO_OUTPUT" ||
    reason === "AI_PARSE_ERROR" ||
    reason === "AI_TIMEOUT" ||
    reason === "AI_PROVIDER_ERROR"
  );
}

function wrapIntermediateGenerationFailure(params: {
  traceId: string;
  primaryModelId: string;
  fallbackModelId: string;
  attempts: IntermediateGenerationAttemptFailure[];
  reason: IntermediateGenerationFailureReason;
  cause: unknown;
}): Error & { cause?: unknown } {
  const wrapped: Error & { cause?: unknown } = new Error(
    `SKETCHI_AI_INTERMEDIATE_FAILED reason=${params.reason} traceId=${params.traceId} models=${params.primaryModelId}->${params.fallbackModelId} attempts=${JSON.stringify(
      params.attempts
    )}`
  );
  wrapped.cause = params.cause;
  return wrapped;
}

function decideNextAfterIntermediateFailure(params: {
  traceId: string;
  primaryModelId: string;
  fallbackModelId: string;
  attempts: IntermediateGenerationAttemptFailure[];
  attemptPlan: string[];
  attemptIndex: number;
  modelId: string;
  error: unknown;
}): { shouldContinue: true } | { shouldContinue: false; error: Error } {
  const {
    traceId,
    primaryModelId,
    fallbackModelId,
    attempts,
    attemptPlan,
    attemptIndex,
    modelId,
    error,
  } = params;

  const reason = classifyIntermediateErrorReason(error);
  attempts.push({
    modelId,
    reason,
    errorName: error instanceof Error ? error.name : undefined,
    errorMessage: error instanceof Error ? error.message : String(error),
  });

  if (!isRetryableIntermediateReason(reason)) {
    return {
      shouldContinue: false,
      error: wrapIntermediateGenerationFailure({
        traceId,
        primaryModelId,
        fallbackModelId,
        attempts,
        reason,
        cause: error,
      }),
    };
  }

  const nextModelId = attemptPlan[attemptIndex + 1];
  if (!nextModelId) {
    return {
      shouldContinue: false,
      error: wrapIntermediateGenerationFailure({
        traceId,
        primaryModelId,
        fallbackModelId,
        attempts,
        reason,
        cause: error,
      }),
    };
  }

  if (nextModelId === modelId) {
    console.log("[ai.generateIntermediate.retry]", {
      traceId,
      modelId,
      reason,
    });
    logEventSafely({
      traceId,
      actionName: "generateIntermediate",
      component: "ai",
      op: "ai.retry",
      stage: "intermediate.retry",
      status: "warning",
      modelId,
      provider: "openrouter",
      reason,
    });
  } else {
    console.log("[ai.generateIntermediate.fallback]", {
      traceId,
      fromModelId: modelId,
      toModelId: nextModelId,
      reason,
    });
    logEventSafely({
      traceId,
      actionName: "generateIntermediate",
      component: "ai",
      op: "ai.fallback",
      stage: "intermediate.fallback",
      status: "warning",
      modelId: nextModelId,
      provider: "openrouter",
      fromModelId: modelId,
      reason,
    });
  }

  return { shouldContinue: true };
}

async function runWithRetryAndOptionalFallback<T>(params: {
  traceId: string;
  primaryModelId: string;
  fallbackModelId: string;
  fallbackEnabled: boolean;
  runAttempt: (modelId: string) => Promise<T>;
}): Promise<{
  result: T;
  usedModelId: string;
  attempts: IntermediateGenerationAttemptFailure[];
}> {
  const {
    traceId,
    primaryModelId,
    fallbackModelId,
    fallbackEnabled,
    runAttempt,
  } = params;

  const attempts: IntermediateGenerationAttemptFailure[] = [];
  const hasFallback = fallbackEnabled && fallbackModelId !== primaryModelId;
  const attemptPlan: string[] = hasFallback
    ? [primaryModelId, fallbackModelId]
    : [primaryModelId, primaryModelId];

  for (
    let attemptIndex = 0;
    attemptIndex < attemptPlan.length;
    attemptIndex++
  ) {
    const modelId = attemptPlan[attemptIndex];
    if (!modelId) {
      continue;
    }

    try {
      logEventSafely({
        traceId,
        actionName: "generateIntermediate",
        component: "ai",
        op: "ai.attempt",
        stage: "intermediate.attempt",
        status: "success",
        attempt: attemptIndex + 1,
        maxAttempts: attemptPlan.length,
        modelId,
        provider: "openrouter",
      });
      const result = await runAttempt(modelId);
      return { result, usedModelId: modelId, attempts };
    } catch (error) {
      const decision = decideNextAfterIntermediateFailure({
        traceId,
        primaryModelId,
        fallbackModelId,
        attempts,
        attemptPlan,
        attemptIndex,
        modelId,
        error,
      });
      logEventSafely(
        {
          traceId,
          actionName: "generateIntermediate",
          component: "ai",
          op: "ai.attempt",
          stage: "intermediate.attempt",
          status: "failed",
          attempt: attemptIndex + 1,
          maxAttempts: attemptPlan.length,
          modelId,
          provider: "openrouter",
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        { level: "warning" }
      );
      if (!decision.shouldContinue) {
        throw decision.error;
      }
    }
  }

  throw wrapIntermediateGenerationFailure({
    traceId,
    primaryModelId,
    fallbackModelId,
    attempts: [],
    reason: "UNKNOWN",
    cause: new Error("unreachable"),
  });
}

/**
 * Generate an IntermediateFormat diagram from a natural language prompt.
 * Uses a ToolLoopAgent with validation to iteratively refine the diagram structure.
 *
 * @param prompt - Natural language description of the desired diagram
 * @param options - Configuration options (e.g., profileId for agent profile selection)
 * @returns Promise resolving to GenerateIntermediateResult with diagram, metadata, and trace info
 */
export async function generateIntermediate(
  prompt: string,
  options: GenerateOptions = {}
): Promise<GenerateIntermediateResult> {
  const traceId = options.traceId ?? crypto.randomUUID();
  const resolvedProfileId = options.profileId ?? "general";
  const profile = getProfile(resolvedProfileId);
  const validateTool = createValidateIntermediateTool(profile);
  const promptLength = prompt.length;
  const promptHash = hashString(prompt);

  const DEFAULT_PRIMARY_MODEL_ID = "google/gemini-3-flash-preview";
  const primaryModelId =
    process.env.MODEL_NAME?.trim() || DEFAULT_PRIMARY_MODEL_ID;

  const envFallbackModelId = process.env.MODEL_FALLBACK_NAME?.trim();
  const fallbackModelId = envFallbackModelId || "z-ai/glm-4.7";
  const fallbackEnabled =
    process.env.SKETCHI_DISABLE_MODEL_FALLBACK !== "1" &&
    fallbackModelId !== primaryModelId;

  const rawTimeoutMs = Number(process.env.SKETCHI_AI_INTERMEDIATE_TIMEOUT_MS);
  const GENERATE_TIMEOUT_MS = Number.isFinite(rawTimeoutMs)
    ? Math.max(5000, rawTimeoutMs)
    : 60_000;

  const createAgent = (modelId: string) => {
    let stepIndex = 0;
    let lastStepAt = Date.now();

    return new ToolLoopAgent({
      model: createOpenRouterChatModel({
        modelId,
        traceId,
        profileId: resolvedProfileId,
      }),
      temperature: 0,
      instructions: profile.instructions,
      output: Output.object({ schema: IntermediateFormatSchema }),
      tools: {
        validateIntermediate: validateTool,
      },
      stopWhen: stepCountIs(5),
      onStepFinish: ({ usage, toolCalls }) => {
        const now = Date.now();
        stepIndex += 1;
        const stepDurationMs = now - lastStepAt;
        lastStepAt = now;
        logEventSafely({
          traceId,
          actionName: "generateIntermediate",
          component: "ai",
          op: "ai.step",
          stage: "intermediate.step",
          status: "success",
          modelId,
          provider: "openrouter",
          step: stepIndex,
          stepDurationMs,
          toolCalls: toolCalls?.length ?? 0,
          tokens: usage.totalTokens ?? 0,
        });
        console.log("[ai.generateIntermediate.step]", {
          traceId,
          modelId,
          toolCalls: toolCalls?.length ?? 0,
          totalTokens: usage.totalTokens,
        });
      },
    });
  };

  type Agent = ReturnType<typeof createAgent>;
  type AgentGenerateResult = Awaited<ReturnType<Agent["generate"]>>;

  const start = Date.now();

  const runAttempt = async (modelId: string): Promise<AgentGenerateResult> => {
    logEventSafely({
      traceId,
      actionName: "generateIntermediate",
      component: "ai",
      op: "ai.start",
      stage: "intermediate.start",
      status: "success",
      modelId,
      provider: "openrouter",
      promptLength,
      promptHash,
      profileId: resolvedProfileId,
    });
    console.log("[ai.generateIntermediate.start]", {
      traceId,
      modelId,
      profileId: resolvedProfileId,
    });

    const agent = createAgent(modelId);
    const result = await agent.generate({
      prompt,
      timeout: GENERATE_TIMEOUT_MS,
    });

    if (!result.output) {
      throw new Error(
        `No output generated after ${result.steps.length} attempts: ${JSON.stringify(
          result.steps.map((s) => s.toolCalls)
        )}`
      );
    }

    return result;
  };

  let result: AgentGenerateResult;
  let usedModelId: string;
  try {
    ({ result, usedModelId } =
      await runWithRetryAndOptionalFallback<AgentGenerateResult>({
        traceId,
        primaryModelId,
        fallbackModelId,
        fallbackEnabled,
        runAttempt,
      }));
  } catch (error) {
    logEventSafely(
      {
        traceId,
        actionName: "generateIntermediate",
        component: "ai",
        op: "ai.complete",
        stage: "intermediate.complete",
        status: "failed",
        durationMs: Date.now() - start,
        modelId: primaryModelId,
        provider: "openrouter",
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      { level: "error" }
    );
    throw error;
  }

  console.log("[ai.generateIntermediate.completed]", {
    traceId,
    modelId: usedModelId,
    responseId: result.response.id,
  });
  logEventSafely({
    traceId,
    actionName: "generateIntermediate",
    component: "ai",
    op: "ai.complete",
    stage: "intermediate.complete",
    status: "success",
    durationMs: Date.now() - start,
    modelId: usedModelId,
    provider: "openrouter",
    iterations: result.steps.length,
    tokens: result.usage.totalTokens ?? 0,
  });

  return {
    intermediate: result.output,
    profileId: resolvedProfileId,
    iterations: result.steps.length,
    tokens: result.usage.totalTokens ?? 0,
    durationMs: Date.now() - start,
    traceId,
  };
}
