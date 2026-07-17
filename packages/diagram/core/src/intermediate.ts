import { z } from "zod";

import { DIAGRAM_TYPES } from "./diagram-types.js";

export const DiagramTypeSchema = z.enum(DIAGRAM_TYPES);

export const LayoutDirectionSchema = z.enum(["TB", "BT", "LR", "RL"]);
export const EdgeRoutingSchema = z.enum(["straight", "orthogonal", "curved"]);

export const DiagramNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  group: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const DiagramEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const DiagramStyleSchema = z.object({
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#0f766e"),
  backgroundColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#ffffff"),
});

export const DiagramLayoutSchema = z.object({
  direction: LayoutDirectionSchema.default("LR"),
  edgeRouting: EdgeRoutingSchema.default("orthogonal"),
});

export const IntermediateDiagramSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: DiagramTypeSchema.default("flowchart"),
  nodes: z.array(DiagramNodeSchema).min(1),
  edges: z.array(DiagramEdgeSchema).default([]),
  layout: DiagramLayoutSchema.default({
    direction: "LR",
    edgeRouting: "orthogonal",
  }),
  style: DiagramStyleSchema.default({
    accentColor: "#0f766e",
    backgroundColor: "#ffffff",
  }),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type DiagramType = z.infer<typeof DiagramTypeSchema>;
export type LayoutDirection = z.infer<typeof LayoutDirectionSchema>;
export type EdgeRouting = z.infer<typeof EdgeRoutingSchema>;
export type DiagramNode = z.infer<typeof DiagramNodeSchema>;
export type DiagramEdge = z.infer<typeof DiagramEdgeSchema>;
export type IntermediateDiagram = z.infer<typeof IntermediateDiagramSchema>;

export class DiagramValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagramValidationError";
  }
}

const findDuplicate = (values: readonly string[]) => {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }

    seen.add(value);
  }

  return undefined;
};

export function validateIntermediateDiagram(
  diagram: IntermediateDiagram,
): IntermediateDiagram {
  const duplicateNodeId = findDuplicate(diagram.nodes.map((node) => node.id));

  if (duplicateNodeId) {
    throw new DiagramValidationError(
      `Duplicate node id "${duplicateNodeId}" is not allowed.`,
    );
  }

  const duplicateEdgeId = findDuplicate(diagram.edges.map((edge) => edge.id));

  if (duplicateEdgeId) {
    throw new DiagramValidationError(
      `Duplicate edge id "${duplicateEdgeId}" is not allowed.`,
    );
  }

  const nodeIds = new Set(diagram.nodes.map((node) => node.id));

  for (const edge of diagram.edges) {
    if (!nodeIds.has(edge.source)) {
      throw new DiagramValidationError(
        `Edge "${edge.id}" references missing source node "${edge.source}".`,
      );
    }

    if (!nodeIds.has(edge.target)) {
      throw new DiagramValidationError(
        `Edge "${edge.id}" references missing target node "${edge.target}".`,
      );
    }

    if (edge.source === edge.target) {
      throw new DiagramValidationError(
        `Edge "${edge.id}" cannot connect node "${edge.source}" to itself.`,
      );
    }
  }

  return diagram;
}

export function parseIntermediateDiagram(input: unknown): IntermediateDiagram {
  const diagram = IntermediateDiagramSchema.parse(input);
  return validateIntermediateDiagram(diagram);
}
