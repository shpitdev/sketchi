import { Output, stepCountIs, ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import { createOpenRouterChatModel } from "../ai/openrouter";
import type {
  IntermediateEdge,
  IntermediateNode,
} from "../diagram-intermediate";
import { IntermediateFormatSchema } from "../diagram-intermediate";
import { validateEdgeReferences } from "../diagram-renderer";
import { generalProfile } from "./profiles/general";
import type {
  GenerateIntermediateResult,
  PromptAgentProfile,
  ValidationError,
} from "./types";

export interface GenerateOptions {
  profileId?: string;
  /**
   * Correlation id for logs/tracing across systems.
   * If not provided, a new UUID is generated.
   */
  traceId?: string;
}

/**
 * Local getProfile to avoid circular dependency with index.ts.
 * Falls back to 'general' profile with warning for unknown profiles.
 */
function getProfile(profileId: string): PromptAgentProfile {
  if (profileId === "general") {
    return generalProfile;
  }
  console.warn(`Profile '${profileId}' not found, falling back to 'general'`);
  return generalProfile;
}

const ValidationInputSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.string().optional(),
      description: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
  ),
  edges: z.array(
    z.object({
      fromId: z.string(),
      toId: z.string(),
      label: z.string().optional(),
    })
  ),
  graphOptions: z
    .object({
      diagramType: z.string().optional(),
      layout: z
        .object({
          direction: z.enum(["TB", "LR", "BT", "RL"]).optional(),
        })
        .optional(),
      style: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

type ValidationInput = z.infer<typeof ValidationInputSchema>;

type IntermediateGenerationFailureReason =
  | "AI_NO_OUTPUT"
  | "AI_PARSE_ERROR"
  | "AI_TIMEOUT"
  | "AI_PROVIDER_ERROR"
  | "AI_VALIDATION_FAILED"
  | "UNKNOWN";

interface IntermediateGenerationAttemptFailure {
  modelId: string;
  reason: IntermediateGenerationFailureReason;
  errorName?: string;
  errorMessage?: string;
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

function createValidateIntermediateTool(profile: PromptAgentProfile) {
  return tool({
    description:
      "Validate the generated IntermediateFormat. Call this after generating to check for errors.",
    inputSchema: ValidationInputSchema,
    execute: (intermediate: ValidationInput) => {
      const errors: ValidationError[] = [];

      const refErrors = validateEdgeReferences(
        intermediate.nodes as IntermediateNode[],
        intermediate.edges as IntermediateEdge[]
      );
      for (const msg of refErrors) {
        errors.push({ type: "reference", message: msg });
      }

      if (intermediate.nodes.length === 0) {
        errors.push({
          type: "semantic",
          message: "At least one node required",
        });
      }

      if (profile.validate) {
        const profileResult = profile.validate(
          intermediate as unknown as import("../diagram-intermediate").IntermediateFormat
        );
        if (!profileResult.ok && profileResult.errors) {
          errors.push(...profileResult.errors);
        }
      }

      return errors.length === 0
        ? { ok: true as const }
        : {
            ok: false as const,
            errors: errors.map((e) => `${e.type}: ${e.message}`),
          };
    },
  });
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
  } else {
    console.log("[ai.generateIntermediate.fallback]", {
      traceId,
      fromModelId: modelId,
      toModelId: nextModelId,
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

  const DEFAULT_PRIMARY_MODEL_ID = "google/gemini-3-flash-preview";
  const primaryModelId =
    process.env.MODEL_NAME?.trim() || DEFAULT_PRIMARY_MODEL_ID;

  const envFallbackModelId = process.env.MODEL_FALLBACK_NAME?.trim();
  const fallbackModelId = envFallbackModelId || "z-ai/glm-4.7";
  const fallbackEnabled =
    Boolean(envFallbackModelId) || primaryModelId === DEFAULT_PRIMARY_MODEL_ID;

  const GENERATE_TIMEOUT_MS = 120_000;

  const createAgent = (modelId: string) =>
    new ToolLoopAgent({
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
        console.log("[ai.generateIntermediate.step]", {
          traceId,
          modelId,
          toolCalls: toolCalls?.length ?? 0,
          totalTokens: usage.totalTokens,
        });
      },
    });

  type Agent = ReturnType<typeof createAgent>;
  type AgentGenerateResult = Awaited<ReturnType<Agent["generate"]>>;

  const start = Date.now();

  const runAttempt = async (modelId: string): Promise<AgentGenerateResult> => {
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
        `Validation failed after ${result.steps.length} attempts: ${JSON.stringify(
          result.steps.map((s) => s.toolCalls)
        )}`
      );
    }

    return result;
  };

  const { result, usedModelId } =
    await runWithRetryAndOptionalFallback<AgentGenerateResult>({
      traceId,
      primaryModelId,
      fallbackModelId,
      fallbackEnabled,
      runAttempt,
    });

  console.log("[ai.generateIntermediate.completed]", {
    traceId,
    modelId: usedModelId,
    responseId: result.response.id,
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
