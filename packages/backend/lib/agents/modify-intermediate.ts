import { Output, stepCountIs, ToolLoopAgent } from "ai";
import { hashString, logEventSafely } from "../../convex/lib/observability";
import { createOpenRouterChatModel } from "../ai/openrouter";
import {
  type IntermediateFormat,
  IntermediateFormatSchema,
} from "../diagram-intermediate";
import { resolvePrompt } from "../prompts";
import { createValidateIntermediateTool } from "./intermediate-validation";
import { getProfile } from "./profile-registry";
import type { GenerateIntermediateResult } from "./types";

export interface ModifyIntermediateOptions {
  /**
   * Maximum tool-loop steps for the agent (default 5).
   */
  maxSteps?: number;
  profileId?: string;
  /**
   * Total wall-clock timeout for the agent call (ms).
   * This is passed through to the AI SDK generate() call.
   */
  timeoutMs?: number;
  /**
   * Correlation id for logs/tracing across systems.
   * If not provided, a new UUID is generated.
   */
  traceId?: string;
}

const DEFAULT_PRIMARY_MODEL_ID = "google/gemini-3-flash-preview";
const DEFAULT_FALLBACK_MODEL_ID = "z-ai/glm-4.7";
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_MAX_STEPS = 5;

function parseIntermediateFormatOrThrow(
  intermediate: unknown
): IntermediateFormat {
  const parsed = IntermediateFormatSchema.safeParse(intermediate);
  if (!parsed.success) {
    throw new Error(
      `Invalid IntermediateFormat: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`
    );
  }
  return parsed.data;
}

function resolveModelConfig(): {
  primaryModelId: string;
  fallbackModelId: string;
  fallbackEnabled: boolean;
} {
  const primaryModelId =
    process.env.MODEL_NAME?.trim() || DEFAULT_PRIMARY_MODEL_ID;
  const fallbackModelId =
    process.env.MODEL_FALLBACK_NAME?.trim() || DEFAULT_FALLBACK_MODEL_ID;
  const fallbackEnabled =
    process.env.SKETCHI_DISABLE_MODEL_FALLBACK !== "1" &&
    fallbackModelId !== primaryModelId;

  return { primaryModelId, fallbackModelId, fallbackEnabled };
}

function normalizeMaxSteps(maxSteps: number | undefined): number {
  if (typeof maxSteps !== "number" || !Number.isFinite(maxSteps)) {
    return DEFAULT_MAX_STEPS;
  }
  return Math.max(1, Math.min(10, maxSteps));
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(5000, timeoutMs);
}

async function runAttemptWithOptionalFallback<T>(params: {
  traceId: string;
  primaryModelId: string;
  fallbackModelId: string;
  fallbackEnabled: boolean;
  runAttempt: (modelId: string) => Promise<T>;
}): Promise<{ result: T; usedModelId: string }> {
  try {
    const result = await params.runAttempt(params.primaryModelId);
    return { result, usedModelId: params.primaryModelId };
  } catch (error) {
    if (!params.fallbackEnabled) {
      throw error;
    }

    logEventSafely({
      traceId: params.traceId,
      actionName: "modifyIntermediate",
      component: "ai",
      op: "ai.fallback",
      stage: "intermediate.fallback",
      status: "warning",
      provider: "openrouter",
      fromModelId: params.primaryModelId,
      modelId: params.fallbackModelId,
      errorName: error instanceof Error ? error.name : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    const result = await params.runAttempt(params.fallbackModelId);
    return { result, usedModelId: params.fallbackModelId };
  }
}

function buildModifyPrompt(params: {
  intermediate: IntermediateFormat;
  request: string;
}): string {
  return [
    "Existing diagram (IntermediateFormat JSON):",
    JSON.stringify(params.intermediate),
    "",
    "User request:",
    params.request,
  ].join("\n");
}

/**
 * Modify an existing IntermediateFormat diagram using a ToolLoopAgent + schema validation.
 * This is used by restructure flows (server-only intermediate stays opaque to clients).
 */
export async function modifyIntermediate(
  intermediate: unknown,
  request: string,
  options: ModifyIntermediateOptions = {}
): Promise<GenerateIntermediateResult> {
  const startedAt = Date.now();
  const traceId = options.traceId ?? crypto.randomUUID();
  const resolvedProfileId = options.profileId ?? "general";
  const profile = getProfile(resolvedProfileId);
  const validateTool = createValidateIntermediateTool(profile);
  const requestLength = request.length;
  const requestHash = hashString(request);

  const parsed = parseIntermediateFormatOrThrow(intermediate);
  const baseNodeCount = parsed.nodes.length;
  const baseEdgeCount = parsed.edges.length;

  const { primaryModelId, fallbackModelId, fallbackEnabled } =
    resolveModelConfig();
  const maxSteps = normalizeMaxSteps(options.maxSteps);
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);

  const instructions = resolvePrompt(
    "core/modification/intermediate-modify"
  ).body;
  const prompt = buildModifyPrompt({ intermediate: parsed, request });

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
      instructions,
      output: Output.object({ schema: IntermediateFormatSchema }),
      tools: {
        validateIntermediate: validateTool,
      },
      stopWhen: stepCountIs(maxSteps),
      onStepFinish: ({ usage, toolCalls }) => {
        const now = Date.now();
        stepIndex += 1;
        const stepDurationMs = now - lastStepAt;
        lastStepAt = now;
        logEventSafely({
          traceId,
          actionName: "modifyIntermediate",
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
        console.log("[ai.modifyIntermediate.step]", {
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

  const runAttempt = async (modelId: string): Promise<AgentGenerateResult> => {
    logEventSafely({
      traceId,
      actionName: "modifyIntermediate",
      component: "ai",
      op: "ai.start",
      stage: "intermediate.start",
      status: "success",
      modelId,
      provider: "openrouter",
      requestLength,
      requestHash,
      baseNodeCount,
      baseEdgeCount,
      profileId: resolvedProfileId,
    });
    console.log("[ai.modifyIntermediate.start]", {
      traceId,
      modelId,
      profileId: resolvedProfileId,
    });

    const agent = createAgent(modelId);
    const result = await agent.generate({ prompt, timeout: timeoutMs });
    if (!result.output) {
      throw new Error(
        `No output generated after ${result.steps.length} attempts: ${JSON.stringify(
          result.steps.map((s) => s.toolCalls)
        )}`
      );
    }
    return result;
  };

  const { result, usedModelId } = await runAttemptWithOptionalFallback({
    traceId,
    primaryModelId,
    fallbackModelId,
    fallbackEnabled,
    runAttempt,
  });

  const durationMs = Date.now() - startedAt;

  logEventSafely({
    traceId,
    actionName: "modifyIntermediate",
    component: "ai",
    op: "ai.complete",
    stage: "intermediate.complete",
    status: "success",
    modelId: usedModelId,
    provider: "openrouter",
    durationMs,
    iterations: result.steps.length,
    tokens: result.totalUsage.totalTokens ?? 0,
  });

  return {
    intermediate: result.output,
    profileId: resolvedProfileId,
    iterations: result.steps.length,
    tokens: result.totalUsage.totalTokens ?? 0,
    durationMs,
    traceId,
  };
}
