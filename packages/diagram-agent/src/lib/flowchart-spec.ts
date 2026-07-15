import {
  FlowchartDiagramSchema,
  validateFlowchartDiagram,
  type FlowchartDiagram,
} from "@sketchi/diagram-core";

import type {
  FlowchartSpec,
  NormalizedFlowchartSpec,
} from "./code-mode-contract.js";
import { cleanToolString } from "./clean-tool-string.js";

const FLOWCHART_TYPE: "flowchart" = "flowchart";
const ORTHOGONAL_ROUTING: "orthogonal" = "orthogonal";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function cleanOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const cleaned = cleanToolString(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function normalizeFlowchartSpec(
  spec: FlowchartSpec,
): NormalizedFlowchartSpec {
  const title = cleanToolString(spec.title);
  const id = cleanOptional(spec.id) ?? (slugify(title) || "sketchi-flowchart");

  return {
    id,
    title,
    nodes: spec.nodes.map((node) => ({
      id: cleanToolString(node.id),
      label: cleanToolString(node.label),
      kind: node.kind,
      ...(node.description
        ? { description: cleanToolString(node.description) }
        : {}),
    })),
    edges: spec.edges.map((edge, index) => ({
      id: cleanOptional(edge.id) ?? `edge-${index + 1}`,
      source: cleanToolString(edge.source),
      target: cleanToolString(edge.target),
      ...(edge.label ? { label: cleanToolString(edge.label) } : {}),
    })),
    layout: {
      direction: spec.layout.direction,
    },
    style: {
      accentColor: spec.style.accentColor,
      backgroundColor: spec.style.backgroundColor,
    },
  };
}

export function flowchartDiagramInput(spec: NormalizedFlowchartSpec) {
  return {
    id: spec.id,
    title: spec.title,
    type: FLOWCHART_TYPE,
    nodes: spec.nodes.map((node) => ({ ...node, metadata: {} })),
    edges: spec.edges.map((edge) => ({ ...edge, metadata: {} })),
    layout: {
      direction: spec.layout.direction,
      edgeRouting: ORTHOGONAL_ROUTING,
    },
    style: spec.style,
    metadata: {},
  };
}

/** Build the validated core diagram used by curated non-persisting views. */
export function flowchartDiagramFromSpec(
  spec: FlowchartSpec,
): FlowchartDiagram {
  const diagram = FlowchartDiagramSchema.parse(
    flowchartDiagramInput(normalizeFlowchartSpec(spec)),
  );
  validateFlowchartDiagram(diagram);
  return diagram;
}
