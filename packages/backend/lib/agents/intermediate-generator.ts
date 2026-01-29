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
  // Graceful fallback - matches registry behavior in index.ts
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

  const validateTool = tool({
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

  const modelId =
    process.env.MODEL_NAME?.trim() || "google/gemini-3-flash-preview";

  const agent = new ToolLoopAgent({
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
        toolCalls: toolCalls?.length ?? 0,
        totalTokens: usage.totalTokens,
      });
    },
  });

  const start = Date.now();
  const result = await agent.generate({ prompt });

  if (!result.output) {
    throw new Error(
      `Validation failed after ${result.steps.length} attempts: ${JSON.stringify(
        result.steps.map((s) => s.toolCalls)
      )}`
    );
  }

  console.log("[ai.generateIntermediate.completed]", {
    traceId,
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
