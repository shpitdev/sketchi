import type {
  IntermediateEdge,
  IntermediateFormat,
  IntermediateNode,
} from "./diagram-intermediate";

const SHAPE_TYPES = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "roundRectangle",
  "parallelogram",
  "hexagon",
  "octagon",
  "triangle",
  "trapezoid",
]);

interface SimplifyStats {
  elementCount: number;
  nodeCount: number;
  edgeCount: number;
}

export interface SimplifyDiagramResult {
  intermediate: IntermediateFormat;
  stats: SimplifyStats;
}

function getBindingId(
  element: Record<string, unknown>,
  bindingKey: "startBinding" | "endBinding",
  legacyKey: "start" | "end"
): string | null {
  const binding = element[bindingKey];
  if (binding && typeof binding === "object") {
    const elementId = (binding as { elementId?: unknown }).elementId;
    if (typeof elementId === "string") {
      return elementId;
    }
  }

  const legacy = element[legacyKey];
  if (legacy && typeof legacy === "object") {
    const legacyId = (legacy as { id?: unknown }).id;
    if (typeof legacyId === "string") {
      return legacyId;
    }
  }

  return null;
}

function resolveLabel(
  element: Record<string, unknown>,
  textByContainer: Map<string, string>,
  fallback: string
): string {
  const id = typeof element.id === "string" ? element.id : undefined;
  if (id) {
    const label = textByContainer.get(id);
    if (label) {
      return label;
    }
  }

  if (typeof element.text === "string" && element.text.trim()) {
    return element.text;
  }

  return fallback;
}

export function simplifyDiagramElements(
  elements: unknown[]
): SimplifyDiagramResult {
  const elementList = Array.isArray(elements) ? elements : [];
  const textByContainer = new Map<string, string>();

  for (const element of elementList) {
    if (!element || typeof element !== "object") {
      continue;
    }
    const base = element as Record<string, unknown>;
    if (base.type !== "text") {
      continue;
    }
    const containerId = base.containerId;
    if (typeof containerId === "string" && typeof base.text === "string") {
      textByContainer.set(containerId, base.text);
    }
  }

  const nodes = new Map<string, IntermediateNode>();

  for (const element of elementList) {
    if (!element || typeof element !== "object") {
      continue;
    }
    const base = element as Record<string, unknown>;
    if (base.isDeleted === true) {
      continue;
    }
    const type = typeof base.type === "string" ? base.type : "";
    if (!SHAPE_TYPES.has(type)) {
      continue;
    }
    const id = typeof base.id === "string" ? base.id : undefined;
    if (!id) {
      continue;
    }

    nodes.set(id, {
      id,
      label: resolveLabel(base, textByContainer, id),
      metadata: { shape: type },
    });
  }

  const edges: IntermediateEdge[] = [];

  for (const element of elementList) {
    if (!element || typeof element !== "object") {
      continue;
    }
    const base = element as Record<string, unknown>;
    if (base.isDeleted === true) {
      continue;
    }
    const type = typeof base.type === "string" ? base.type : "";
    if (type !== "arrow") {
      continue;
    }

    const fromId = getBindingId(base, "startBinding", "start");
    const toId = getBindingId(base, "endBinding", "end");
    if (!(fromId && toId)) {
      continue;
    }
    if (!(nodes.has(fromId) && nodes.has(toId))) {
      continue;
    }

    const label = resolveLabel(base, textByContainer, "");

    edges.push({
      id: typeof base.id === "string" ? base.id : undefined,
      fromId,
      toId,
      label: label || undefined,
    });
  }

  return {
    intermediate: {
      nodes: Array.from(nodes.values()),
      edges,
    },
    stats: {
      elementCount: elementList.length,
      nodeCount: nodes.size,
      edgeCount: edges.length,
    },
  };
}
