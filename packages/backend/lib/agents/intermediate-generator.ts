import { gateway, Output, stepCountIs, ToolLoopAgent, tool } from "ai";
import { z } from "zod";
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
}

function getProfile(profileId: string): PromptAgentProfile {
  if (profileId === "general") {
    return generalProfile;
  }
  throw new Error(`Unknown profile: ${profileId}`);
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
  const traceId = crypto.randomUUID();
  const profile = getProfile(options.profileId ?? "general");

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

  const agent = new ToolLoopAgent({
    model: gateway("google/gemini-3-flash"),
    instructions: profile.instructions,
    output: Output.object({ schema: IntermediateFormatSchema }),
    tools: {
      validateIntermediate: validateTool,
    },
    stopWhen: stepCountIs(5),
    onStepFinish: ({ usage, toolCalls }) => {
      console.log(
        `[${traceId}] Step: tools=${toolCalls?.length ?? 0}, tokens=${usage.totalTokens}`
      );
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

  return {
    intermediate: result.output,
    profileId: options.profileId ?? "general",
    iterations: result.steps.length,
    tokens: result.usage.totalTokens ?? 0,
    durationMs: Date.now() - start,
    traceId,
  };
}
