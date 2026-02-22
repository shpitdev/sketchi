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
import { applyTemplateDefaults } from "./template-autofill";
import { getTemplateForType } from "./templates";

export interface RenderedDiagramResult {
  diagram: Diagram;
  elements: Record<string, unknown>[];
  layouted: LayoutedDiagram;
  stats: {
    nodeCount: number;
    edgeCount: number;
    shapeCount: number;
    arrowCount: number;
  };
}

function toExcalidrawStyleOverrides(
  style?: GraphStyle,
  arrowhead?: "arrow" | null
): ExcalidrawStyleOverrides | undefined {
  return {
    shapeFill: style?.shapeFill,
    shapeStroke: style?.shapeStroke,
    arrowStroke: style?.arrowStroke,
    arrowhead,
    textColor: style?.textColor,
    fontSize: style?.fontSize,
    fontFamily: style?.fontFamily,
  };
}

export function renderIntermediateDiagram(
  intermediate: IntermediateFormat
): RenderedDiagramResult {
  const enriched = applyTemplateDefaults(intermediate);
  const template = getTemplateForType(enriched.graphOptions?.diagramType);
  const { diagram, layouted } = layoutIntermediateDiagram(enriched);
  const elements = convertLayoutedToExcalidraw(
    layouted,
    toExcalidrawStyleOverrides(
      enriched.graphOptions?.style,
      template.edgeDefaults.arrowhead
    )
  );

  return {
    diagram,
    layouted,
    elements,
    stats: {
      nodeCount: enriched.nodes.length,
      edgeCount: enriched.edges.length,
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
