import { z } from "zod";

import {
  DiagramEdgeSchema,
  DiagramNodeSchema,
  DiagramValidationError,
  IntermediateDiagramSchema,
  validateIntermediateDiagram,
} from "../intermediate.js";

export const mindmapDiagramType = "mindmap" as const;

export const MindmapNodeSchema = DiagramNodeSchema.extend({
  kind: z.enum(["root", "topic"]),
  metadata: z.object({
    depth: z.number().int().nonnegative(),
    siblingIndex: z.number().int().nonnegative(),
  }),
});

export const MindmapEdgeSchema = DiagramEdgeSchema.extend({
  metadata: z.object({
    depth: z.number().int().positive(),
    siblingIndex: z.number().int().nonnegative(),
  }),
});

export const MindmapDiagramSchema = IntermediateDiagramSchema.extend({
  type: z.literal(mindmapDiagramType),
  nodes: z.array(MindmapNodeSchema).min(2),
  edges: z.array(MindmapEdgeSchema).min(1),
});

export type MindmapDiagram = z.infer<typeof MindmapDiagramSchema>;

export function validateMindmapDiagram(
  diagram: MindmapDiagram,
): MindmapDiagram {
  validateIntermediateDiagram(diagram);
  const roots = diagram.nodes.filter((node) => node.kind === "root");
  if (roots.length !== 1) {
    throw new DiagramValidationError(
      `Mindmap must contain exactly one root topic; found ${roots.length}.`,
    );
  }

  const root = roots[0];
  if (!root || root.metadata.depth !== 0) {
    throw new DiagramValidationError("Mindmap root topic must have depth 0.");
  }

  const incoming = new Map<string, number>();
  const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, number[]>();
  for (const edge of diagram.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    const sourceDepth = nodeById.get(edge.source)?.metadata.depth;
    const target = nodeById.get(edge.target);
    const targetDepth = target?.metadata.depth;
    if (sourceDepth === undefined || targetDepth !== sourceDepth + 1) {
      throw new DiagramValidationError(
        `Mindmap edge "${edge.id}" must connect a topic to its immediate child.`,
      );
    }
    if (
      !target ||
      edge.metadata.depth !== target.metadata.depth ||
      edge.metadata.siblingIndex !== target.metadata.siblingIndex
    ) {
      throw new DiagramValidationError(
        `Mindmap edge "${edge.id}" metadata must match its child topic.`,
      );
    }
    childrenByParent.set(edge.source, [
      ...(childrenByParent.get(edge.source) ?? []),
      target.metadata.siblingIndex,
    ]);
  }

  for (const node of diagram.nodes) {
    const count = incoming.get(node.id) ?? 0;
    if (node.id === root.id ? count !== 0 : count !== 1) {
      throw new DiagramValidationError(
        `Mindmap topic "${node.id}" must have ${node.id === root.id ? "no parent" : "exactly one parent"}.`,
      );
    }
  }
  for (const [parentId, siblingIndexes] of childrenByParent) {
    const expected = siblingIndexes.map((_, index) => index);
    const actual = [...siblingIndexes].sort((left, right) => left - right);
    if (actual.some((value, index) => value !== expected[index])) {
      throw new DiagramValidationError(
        `Mindmap children of "${parentId}" must use contiguous sibling ordering from 0.`,
      );
    }
  }
  return diagram;
}

export function parseMindmapDiagram(input: unknown): MindmapDiagram {
  return validateMindmapDiagram(MindmapDiagramSchema.parse(input));
}

export const mindmapFixture = parseMindmapDiagram({
  id: "public-mindmap-capability",
  title: "Public mindmap generation",
  type: mindmapDiagramType,
  nodes: [
    {
      id: "topic-0",
      label: "Public mindmaps",
      kind: "root",
      metadata: { depth: 0, siblingIndex: 0 },
    },
    {
      id: "topic-0-0",
      label: "Semantic input",
      kind: "topic",
      metadata: { depth: 1, siblingIndex: 0 },
    },
    {
      id: "topic-0-0-0",
      label: "Nested topics",
      kind: "topic",
      metadata: { depth: 2, siblingIndex: 0 },
    },
    {
      id: "topic-0-0-1",
      label: "Stable ordering",
      kind: "topic",
      metadata: { depth: 2, siblingIndex: 1 },
    },
    {
      id: "topic-0-1",
      label: "Artifact output",
      kind: "topic",
      metadata: { depth: 1, siblingIndex: 1 },
    },
    {
      id: "topic-0-1-0",
      label: "Scene",
      kind: "topic",
      metadata: { depth: 2, siblingIndex: 0 },
    },
    {
      id: "topic-0-1-1",
      label: "Excalidraw",
      kind: "topic",
      metadata: { depth: 2, siblingIndex: 1 },
    },
  ],
  edges: [
    {
      id: "branch-0-0",
      source: "topic-0",
      target: "topic-0-0",
      metadata: { depth: 1, siblingIndex: 0 },
    },
    {
      id: "branch-0-0-0",
      source: "topic-0-0",
      target: "topic-0-0-0",
      metadata: { depth: 2, siblingIndex: 0 },
    },
    {
      id: "branch-0-0-1",
      source: "topic-0-0",
      target: "topic-0-0-1",
      metadata: { depth: 2, siblingIndex: 1 },
    },
    {
      id: "branch-0-1",
      source: "topic-0",
      target: "topic-0-1",
      metadata: { depth: 1, siblingIndex: 1 },
    },
    {
      id: "branch-0-1-0",
      source: "topic-0-1",
      target: "topic-0-1-0",
      metadata: { depth: 2, siblingIndex: 0 },
    },
    {
      id: "branch-0-1-1",
      source: "topic-0-1",
      target: "topic-0-1-1",
      metadata: { depth: 2, siblingIndex: 1 },
    },
  ],
  layout: { direction: "LR", edgeRouting: "curved" },
  style: { accentColor: "#7c3aed", backgroundColor: "#ffffff" },
});
