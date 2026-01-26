import type {
  IntermediateFormat,
  IntermediateNode,
} from "./diagram-intermediate";
import type {
  ArrowElement,
  Diagram,
  ShapeElement,
  ShapeType,
} from "./diagram-structure";
import type { EdgeRouting, LayoutOverrides } from "./diagram-layout-types";

function normalizeShapeOverride(value: unknown): ShapeType | undefined {
  if (value === "rectangle" || value === "ellipse" || value === "diamond") {
    return value;
  }
  return undefined;
}

function resolveShapeType(node: IntermediateNode): ShapeType {
  const override = normalizeShapeOverride(node.metadata?.shape);
  if (override) {
    return override;
  }

  const kind = node.kind?.toLowerCase() ?? "";
  if (kind.includes("decision")) {
    return "diamond";
  }
  if (
    kind.includes("start") ||
    kind.includes("end") ||
    kind.includes("actor") ||
    kind.includes("external")
  ) {
    return "ellipse";
  }
  return "rectangle";
}

function resolveNodeColor(node: IntermediateNode): string | undefined {
  const color = node.metadata?.color ?? node.metadata?.backgroundColor;
  return typeof color === "string" ? color : undefined;
}

function normalizeEdgeRouting(value: unknown): EdgeRouting | undefined {
  if (value === "elbow" || value === "straight") {
    return value;
  }
  return undefined;
}

function compareStringsDeterministic(a?: string | null, b?: string | null): number {
  const left = a ?? "";
  const right = b ?? "";
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function toLayoutOverrides(
  intermediate: IntermediateFormat
): LayoutOverrides | undefined {
  const layout = intermediate.graphOptions?.layout;
  if (!layout) {
    return undefined;
  }

  return {
    direction: layout.direction,
    nodesep: layout.nodesep,
    ranksep: layout.ranksep,
    edgesep: layout.edgesep,
    edgeRouting: normalizeEdgeRouting(layout.edgeRouting),
  };
}

export function convertIntermediateToDiagram(
  intermediate: IntermediateFormat
): Diagram {
  const sortedNodes = [...intermediate.nodes].sort((a, b) =>
    compareStringsDeterministic(a.id, b.id)
  );
  const sortedEdges = [...intermediate.edges].sort((a, b) => {
    const from = compareStringsDeterministic(a.fromId, b.fromId);
    if (from !== 0) {
      return from;
    }
    const to = compareStringsDeterministic(a.toId, b.toId);
    if (to !== 0) {
      return to;
    }
    const label = compareStringsDeterministic(a.label, b.label);
    if (label !== 0) {
      return label;
    }
    return compareStringsDeterministic(a.id, b.id);
  });

  const shapes: ShapeElement[] = sortedNodes.map((node) => ({
    type: resolveShapeType(node),
    id: node.id,
    label: { text: node.label },
    backgroundColor: resolveNodeColor(node),
  }));

  const arrows: ArrowElement[] = sortedEdges.map((edge, index) => ({
    id: edge.id ?? `edge_${index}_${edge.fromId}_${edge.toId}`,
    fromId: edge.fromId,
    toId: edge.toId,
    label: edge.label ? { text: edge.label } : undefined,
  }));

  return { shapes, arrows };
}
