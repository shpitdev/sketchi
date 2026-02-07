import { tool } from "ai";
import { z } from "zod";
import type {
  IntermediateEdge,
  IntermediateFormat,
  IntermediateNode,
} from "../diagram-intermediate";
import { validateEdgeReferences } from "../diagram-renderer";
import type { PromptAgentProfile, ValidationError } from "./types";

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

export function createValidateIntermediateTool(profile: PromptAgentProfile) {
  return tool({
    description:
      "Validate the generated IntermediateFormat. Call this after generating/modifying to check for errors.",
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
          intermediate as unknown as IntermediateFormat
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
