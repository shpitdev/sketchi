import type {
  GraphStyle,
  IntermediateEdge,
  IntermediateFormat,
  IntermediateNode,
} from "./diagram-intermediate";
import type { LayoutedDiagram } from "./diagram-layout";
import { layoutIntermediateDiagram } from "./diagram-layout";
import type { Diagram } from "./diagram-structure";
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
  const { diagram, layouted } = layoutIntermediateDiagram(intermediate);
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
