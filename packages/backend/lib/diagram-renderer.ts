import type {
  LayoutedDiagram,
  LayoutOverrides,
} from "../experiments/lib/layout";
import { applyLayout } from "../experiments/lib/layout";
import {
  DEFAULT_DIAGRAM_TYPE,
  type GraphStyle,
  type IntermediateEdge,
  type IntermediateFormat,
  type IntermediateNode,
} from "./diagram-intermediate";
import type { Diagram, ShapeElement, ShapeType } from "./diagram-structure";
import type { ExcalidrawStyleOverrides } from "./excalidraw-elements";
import { convertLayoutedToExcalidraw } from "./excalidraw-elements";

export interface RenderedDiagramResult {
  diagram: Diagram;
  layouted: LayoutedDiagram;
  elements: Record<string, unknown>[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    shapeCount: number;
    arrowCount: number;
  };
}

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

export function convertIntermediateToDiagram(
  intermediate: IntermediateFormat
): Diagram {
  const shapes: ShapeElement[] = intermediate.nodes.map((node) => ({
    type: resolveShapeType(node),
    id: node.id,
    label: { text: node.label },
    backgroundColor: resolveNodeColor(node),
  }));

  const arrows = intermediate.edges.map((edge, index) => ({
    id: edge.id ?? `edge_${index}`,
    fromId: edge.fromId,
    toId: edge.toId,
    label: edge.label ? { text: edge.label } : undefined,
  }));

  return { shapes, arrows };
}

function toLayoutOverrides(
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
  };
}

function toExcalidrawStyleOverrides(
  style?: GraphStyle
): ExcalidrawStyleOverrides | undefined {
  if (!style) {
    return undefined;
  }

  return {
    shapeFill: style.shapeFill,
    shapeStroke: style.shapeStroke,
    arrowStroke: style.arrowStroke,
    textColor: style.textColor,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
  };
}

export function renderIntermediateDiagram(
  intermediate: IntermediateFormat
): RenderedDiagramResult {
  const diagram = convertIntermediateToDiagram(intermediate);
  const diagramType =
    intermediate.graphOptions?.diagramType ?? DEFAULT_DIAGRAM_TYPE;
  const layouted = applyLayout(
    diagram,
    diagramType,
    toLayoutOverrides(intermediate)
  );
  const elements = convertLayoutedToExcalidraw(
    layouted,
    toExcalidrawStyleOverrides(intermediate.graphOptions?.style)
  );

  return {
    diagram,
    layouted,
    elements,
    stats: {
      nodeCount: intermediate.nodes.length,
      edgeCount: intermediate.edges.length,
      shapeCount: diagram.shapes.length,
      arrowCount: diagram.arrows.length,
    },
  };
}

export function normalizeIntermediate(
  intermediate: IntermediateFormat
): IntermediateFormat {
  return {
    ...intermediate,
    nodes: [...intermediate.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...intermediate.edges].sort((a, b) =>
      a.fromId.localeCompare(b.fromId)
    ),
  };
}

export function validateEdgeReferences(
  nodes: IntermediateNode[],
  edges: IntermediateEdge[]
): string[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const errors: string[] = [];

  for (const edge of edges) {
    if (!nodeIds.has(edge.fromId)) {
      errors.push(`Missing fromId node: ${edge.fromId}`);
    }
    if (!nodeIds.has(edge.toId)) {
      errors.push(`Missing toId node: ${edge.toId}`);
    }
  }

  return errors;
}
