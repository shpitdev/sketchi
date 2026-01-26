import { z } from "zod";

export const DiagramTypeSchema = z.enum([
  "flowchart",
  "mindmap",
  "orgchart",
  "sequence",
  "class",
  "er",
  "gantt",
  "timeline",
  "tree",
  "network",
  "architecture",
  "dataflow",
  "state",
  "swimlane",
  "concept",
  "fishbone",
  "swot",
  "pyramid",
  "funnel",
  "venn",
  "matrix",
  "infographic",
  "decision-tree",
]);
export type DiagramType = z.infer<typeof DiagramTypeSchema>;

export const LayoutDirectionSchema = z.enum(["TB", "LR", "BT", "RL"]);
export type LayoutDirection = z.infer<typeof LayoutDirectionSchema>;

export const EdgeRoutingSchema = z.enum(["straight", "elbow"]);
export type EdgeRouting = z.infer<typeof EdgeRoutingSchema>;

export const NodeSchema = z
  .object({
    id: z.string().describe("Unique node identifier"),
    label: z.string().describe("Display label for the node"),
    kind: z
      .string()
      .optional()
      .describe("Semantic kind (start, decision, actor, etc.)"),
    description: z
      .string()
      .optional()
      .describe("Optional long-form description"),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Optional metadata bag"),
  })
  .strict();
export type IntermediateNode = z.infer<typeof NodeSchema>;

export const EdgeSchema = z
  .object({
    id: z.string().optional().describe("Optional edge identifier"),
    fromId: z.string().describe("Source node id"),
    toId: z.string().describe("Target node id"),
    label: z.string().optional().describe("Optional edge label"),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Optional metadata bag"),
  })
  .strict();
export type IntermediateEdge = z.infer<typeof EdgeSchema>;

export const GraphStyleSchema = z
  .object({
    shapeFill: z.string().optional().describe("Default fill color for shapes"),
    shapeStroke: z
      .string()
      .optional()
      .describe("Default stroke color for shapes"),
    arrowStroke: z
      .string()
      .optional()
      .describe("Default stroke color for arrows"),
    textColor: z.string().optional().describe("Default text color"),
    fontSize: z.number().optional().describe("Default font size"),
    fontFamily: z.number().optional().describe("Default font family"),
  })
  .strict();
export type GraphStyle = z.infer<typeof GraphStyleSchema>;

export const GraphLayoutSchema = z
  .object({
    direction: LayoutDirectionSchema.optional().describe("Layout direction"),
    nodesep: z.number().optional().describe("Node separation"),
    ranksep: z.number().optional().describe("Rank separation"),
    edgesep: z.number().optional().describe("Edge separation"),
    edgeRouting: EdgeRoutingSchema.optional().describe("Edge routing style"),
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

export const IntermediateFormatSchema = z
  .object({
    nodes: z.array(NodeSchema).describe("Diagram nodes"),
    edges: z.array(EdgeSchema).describe("Diagram edges"),
    graphOptions: GraphOptionsSchema.optional().describe("Graph-level options"),
  })
  .strict();
export type IntermediateFormat = z.infer<typeof IntermediateFormatSchema>;

export const DEFAULT_DIAGRAM_TYPE: DiagramType = "flowchart";
