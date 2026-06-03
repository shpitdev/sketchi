import { z } from "zod";

import { DIAGRAM_TYPES } from "./diagram-types";

export const DiagramTypeSchema = z.enum(DIAGRAM_TYPES);

export type DiagramType = z.infer<typeof DiagramTypeSchema>;

export const LayoutDirectionSchema = z.enum(["TB", "LR", "BT", "RL"]);
export type LayoutDirection = z.infer<typeof LayoutDirectionSchema>;

export const EdgeRoutingSchema = z.enum(["straight", "elbow"]);
export type EdgeRouting = z.infer<typeof EdgeRoutingSchema>;

export const IntermediateNodeSchema = z
  .object({
    description: z
      .string()
      .optional()
      .describe("Optional long-form description"),
    id: z.string().min(1).describe("Unique node identifier"),
    kind: z
      .string()
      .optional()
      .describe("Semantic kind (start, decision, actor, etc.)"),
    label: z.string().min(1).describe("Display label for the node"),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Optional metadata bag"),
  })
  .strict();

export type IntermediateNode = z.infer<typeof IntermediateNodeSchema>;
export const NodeSchema = IntermediateNodeSchema;

export const IntermediateEdgeSchema = z
  .object({
    fromId: z.string().min(1).describe("Source node id"),
    id: z.string().min(1).optional().describe("Optional edge identifier"),
    label: z.string().optional().describe("Optional edge label"),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Optional metadata bag"),
    toId: z.string().min(1).describe("Target node id"),
  })
  .strict();

export type IntermediateEdge = z.infer<typeof IntermediateEdgeSchema>;
export const EdgeSchema = IntermediateEdgeSchema;

export const GraphStyleSchema = z
  .object({
    arrowStroke: z
      .string()
      .optional()
      .describe("Default stroke color for arrows"),
    fontFamily: z.number().optional().describe("Default font family"),
    fontSize: z.number().optional().describe("Default font size"),
    shapeFill: z.string().optional().describe("Default fill color for shapes"),
    shapeStroke: z
      .string()
      .optional()
      .describe("Default stroke color for shapes"),
    textColor: z.string().optional().describe("Default text color"),
  })
  .strict();

export type GraphStyle = z.infer<typeof GraphStyleSchema>;

export const GraphLayoutSchema = z
  .object({
    direction: LayoutDirectionSchema.optional().describe("Layout direction"),
    edgeRouting: EdgeRoutingSchema.optional().describe("Edge routing style"),
    edgesep: z.number().positive().optional().describe("Edge separation"),
    nodesep: z.number().positive().optional().describe("Node separation"),
    ranksep: z.number().positive().optional().describe("Rank separation"),
  })
  .strict();

export type GraphLayout = z.infer<typeof GraphLayoutSchema>;

export const GraphOptionsSchema = z
  .object({
    diagramType: DiagramTypeSchema.optional().describe("Diagram type"),
    layout: GraphLayoutSchema.optional().describe("Layout overrides"),
    style: GraphStyleSchema.optional().describe("Global style overrides"),
  })
  .strict();

export type GraphOptions = z.infer<typeof GraphOptionsSchema>;

export const IntermediateDiagramSchema = z
  .object({
    edges: z.array(IntermediateEdgeSchema).describe("Diagram edges"),
    graphOptions: GraphOptionsSchema.optional().describe("Graph-level options"),
    nodes: z.array(IntermediateNodeSchema).min(1).describe("Diagram nodes"),
  })
  .strict();

export type IntermediateDiagram = z.infer<typeof IntermediateDiagramSchema>;
export const IntermediateFormatSchema = IntermediateDiagramSchema;
export type IntermediateFormat = IntermediateDiagram;

export const DEFAULT_DIAGRAM_TYPE: DiagramType = "flowchart";

export interface DiagramValidationIssue {
  code:
    | "duplicate-node-id"
    | "duplicate-edge-id"
    | "missing-node-reference"
    | "self-edge";
  message: string;
  path: string;
}

export interface DiagramValidationResult {
  issues: DiagramValidationIssue[];
  ok: boolean;
}

export function validateIntermediateDiagram(
  diagram: IntermediateDiagram
): DiagramValidationResult {
  const issues: DiagramValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const [index, node] of diagram.nodes.entries()) {
    if (nodeIds.has(node.id)) {
      issues.push({
        code: "duplicate-node-id",
        message: `Node id '${node.id}' is used more than once.`,
        path: `nodes.${index}.id`,
      });
    }
    nodeIds.add(node.id);
  }

  for (const [index, edge] of diagram.edges.entries()) {
    if (edge.id) {
      if (edgeIds.has(edge.id)) {
        issues.push({
          code: "duplicate-edge-id",
          message: `Edge id '${edge.id}' is used more than once.`,
          path: `edges.${index}.id`,
        });
      }
      edgeIds.add(edge.id);
    }

    if (!nodeIds.has(edge.fromId)) {
      issues.push({
        code: "missing-node-reference",
        message: `Edge '${edge.id ?? index}' references missing fromId '${edge.fromId}'.`,
        path: `edges.${index}.fromId`,
      });
    }

    if (!nodeIds.has(edge.toId)) {
      issues.push({
        code: "missing-node-reference",
        message: `Edge '${edge.id ?? index}' references missing toId '${edge.toId}'.`,
        path: `edges.${index}.toId`,
      });
    }

    if (edge.fromId === edge.toId) {
      issues.push({
        code: "self-edge",
        message: `Edge '${edge.id ?? index}' connects '${edge.fromId}' to itself.`,
        path: `edges.${index}`,
      });
    }
  }

  return {
    issues,
    ok: issues.length === 0,
  };
}

export function parseIntermediateDiagram(input: unknown): IntermediateDiagram {
  const parsed = IntermediateDiagramSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Invalid intermediate diagram: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`
    );
  }

  const semantic = validateIntermediateDiagram(parsed.data);
  if (!semantic.ok) {
    throw new Error(
      `Invalid intermediate diagram: ${semantic.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`
    );
  }

  return parsed.data;
}
