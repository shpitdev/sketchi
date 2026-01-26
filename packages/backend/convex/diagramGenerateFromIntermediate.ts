import { v } from "convex/values";
import { IntermediateFormatSchema } from "../lib/diagram-intermediate";
import {
  renderIntermediateDiagram,
  validateEdgeReferences,
} from "../lib/diagram-renderer";
import { action } from "./_generated/server";

export const generateDiagramFromIntermediate = action({
  args: {
    intermediate: v.any(),
  },
  handler: (_ctx, args) => {
    const parsed = IntermediateFormatSchema.safeParse(args.intermediate);
    if (!parsed.success) {
      throw new Error(
        `Invalid IntermediateFormat: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`
      );
    }

    const intermediate = parsed.data;
    const edgeErrors = validateEdgeReferences(
      intermediate.nodes,
      intermediate.edges
    );
    if (edgeErrors.length > 0) {
      throw new Error(`Invalid edge references: ${edgeErrors.join(", ")}`);
    }

    const result = renderIntermediateDiagram(intermediate);

    return {
      intermediate,
      diagram: result.diagram,
      elements: result.elements,
      stats: result.stats,
    };
  },
});
