import {
  type IntermediateDiagram,
  parseIntermediateDiagram,
} from "@sketchi/diagram-core";

export interface SceneElementBase {
  backgroundColor: string;
  height: number;
  id: string;
  label?: string;
  strokeColor: string;
  type: "arrow" | "rectangle" | "text";
  width: number;
  x: number;
  y: number;
}

export interface RectangleSceneElement extends SceneElementBase {
  type: "rectangle";
}

export interface TextSceneElement extends SceneElementBase {
  fontSize: number;
  text: string;
  type: "text";
}

export interface ArrowSceneElement extends SceneElementBase {
  fromId: string;
  label?: string;
  points: Array<{ x: number; y: number }>;
  toId: string;
  type: "arrow";
}

export type SceneElement =
  | ArrowSceneElement
  | RectangleSceneElement
  | TextSceneElement;

export interface RenderedDiagramScene {
  appState: {
    diagramType: string;
    viewBackgroundColor: string;
  };
  elements: SceneElement[];
  stats: {
    arrowCount: number;
    edgeCount: number;
    nodeCount: number;
    shapeCount: number;
  };
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 72;
const HORIZONTAL_GAP = 88;
const VERTICAL_GAP = 72;
const TEXT_INSET_X = 16;
const TEXT_INSET_Y = 24;

function directionFor(diagram: IntermediateDiagram): "BT" | "LR" | "RL" | "TB" {
  return diagram.graphOptions?.layout?.direction ?? "LR";
}

function positionForIndex(index: number, direction: "BT" | "LR" | "RL" | "TB") {
  const column = index;
  const row = index;
  switch (direction) {
    case "BT":
      return {
        x: 0,
        y: -(row * (NODE_HEIGHT + VERTICAL_GAP)),
      };
    case "RL":
      return {
        x: -(column * (NODE_WIDTH + HORIZONTAL_GAP)),
        y: 0,
      };
    case "TB":
      return {
        x: 0,
        y: row * (NODE_HEIGHT + VERTICAL_GAP),
      };
    case "LR":
      return {
        x: column * (NODE_WIDTH + HORIZONTAL_GAP),
        y: 0,
      };
    default: {
      const unreachableDirection: never = direction;
      return unreachableDirection;
    }
  }
}

function centerOf(element: SceneElementBase) {
  return {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };
}

export function renderIntermediateDiagram(
  input: unknown
): RenderedDiagramScene {
  const diagram = parseIntermediateDiagram(input);
  const direction = directionFor(diagram);
  const shapeByNodeId = new Map<string, RectangleSceneElement>();
  const elements: SceneElement[] = [];

  for (const [index, node] of diagram.nodes.entries()) {
    const position = positionForIndex(index, direction);
    const shape: RectangleSceneElement = {
      backgroundColor: diagram.graphOptions?.style?.shapeFill ?? "#dbeafe",
      height: NODE_HEIGHT,
      id: `${node.id}_shape`,
      label: node.label,
      strokeColor: diagram.graphOptions?.style?.shapeStroke ?? "#1d4ed8",
      type: "rectangle",
      width: NODE_WIDTH,
      x: position.x,
      y: position.y,
    };
    const text: TextSceneElement = {
      backgroundColor: "transparent",
      fontSize: diagram.graphOptions?.style?.fontSize ?? 16,
      height: NODE_HEIGHT - TEXT_INSET_Y,
      id: `${node.id}_text`,
      strokeColor: diagram.graphOptions?.style?.textColor ?? "#111827",
      text: node.label,
      type: "text",
      width: NODE_WIDTH - TEXT_INSET_X * 2,
      x: position.x + TEXT_INSET_X,
      y: position.y + TEXT_INSET_Y,
    };

    shapeByNodeId.set(node.id, shape);
    elements.push(shape, text);
  }

  for (const [index, edge] of diagram.edges.entries()) {
    const from = shapeByNodeId.get(edge.fromId);
    const to = shapeByNodeId.get(edge.toId);
    if (!(from && to)) {
      continue;
    }
    const fromCenter = centerOf(from);
    const toCenter = centerOf(to);
    const arrow: ArrowSceneElement = {
      backgroundColor: "transparent",
      fromId: edge.fromId,
      height: Math.abs(toCenter.y - fromCenter.y) || 1,
      id: edge.id ?? `edge_${index}`,
      points: [fromCenter, toCenter],
      strokeColor: diagram.graphOptions?.style?.arrowStroke ?? "#334155",
      toId: edge.toId,
      type: "arrow",
      width: Math.abs(toCenter.x - fromCenter.x) || 1,
      x: Math.min(fromCenter.x, toCenter.x),
      y: Math.min(fromCenter.y, toCenter.y),
    };
    if (edge.label) {
      arrow.label = edge.label;
    }
    elements.push(arrow);
  }

  return {
    appState: {
      diagramType: diagram.graphOptions?.diagramType ?? "flowchart",
      viewBackgroundColor: "#ffffff",
    },
    elements,
    stats: {
      arrowCount: diagram.edges.length,
      edgeCount: diagram.edges.length,
      nodeCount: diagram.nodes.length,
      shapeCount: diagram.nodes.length,
    },
  };
}
