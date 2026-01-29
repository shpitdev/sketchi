import type { IntermediateFormat } from "../../diagram-intermediate";
import { resolvePrompt } from "../../prompts";
import type {
  PromptAgentProfile,
  ValidationError,
  ValidationResult,
} from "../types";

/**
 * General-purpose diagram agent profile.
 * Handles natural language descriptions and converts them to intermediate diagram format.
 * Supports all 23 diagram types with flexible node/edge extraction and layout guidance.
 */
const instructions = resolvePrompt("core/generation/intermediate-auto").body;

export const generalProfile: PromptAgentProfile = {
  id: "general",
  description:
    "General-purpose diagram agent that converts natural language descriptions into structured diagrams",
  instructions,

  validate(intermediate: IntermediateFormat): ValidationResult {
    const errors: ValidationError[] = [];

    if (!intermediate.nodes || intermediate.nodes.length === 0) {
      errors.push({
        type: "semantic",
        message: "Diagram must contain at least one node",
        suggestion: "Add nodes representing entities, processes, or concepts",
      });
      return { ok: false, errors };
    }

    const isSingleNode = intermediate.nodes.length < 2;
    const hasEdges = intermediate.edges && intermediate.edges.length > 0;

    if (isSingleNode && hasEdges) {
      errors.push({
        type: "semantic",
        message: "Cannot have edges with only one node",
        suggestion: "Add more nodes or remove edges",
      });
    }

    if (!(isSingleNode || hasEdges)) {
      errors.push({
        type: "semantic",
        message: "Multi-node diagrams must have at least one edge",
        suggestion: "Add edges to connect the nodes",
      });
    }

    if (hasEdges) {
      const nodeIds = new Set(intermediate.nodes.map((n) => n.id));

      for (let i = 0; i < intermediate.edges.length; i++) {
        const edge = intermediate.edges[i];
        if (!edge) {
          continue;
        }

        if (!nodeIds.has(edge.fromId)) {
          errors.push({
            type: "reference",
            path: `edges[${i}].fromId`,
            message: `Edge references non-existent node: "${edge.fromId}"`,
            suggestion: `Use one of: ${Array.from(nodeIds).join(", ")}`,
          });
        }

        if (!nodeIds.has(edge.toId)) {
          errors.push({
            type: "reference",
            path: `edges[${i}].toId`,
            message: `Edge references non-existent node: "${edge.toId}"`,
            suggestion: `Use one of: ${Array.from(nodeIds).join(", ")}`,
          });
        }
      }
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }
    return { ok: true };
  },
};
