import dagre from "dagre";
import type {
  ArrowElement,
  Diagram,
  ShapeElement,
} from "../../lib/diagram-structure";

type ChartType =
  | "flowchart"
  | "architecture"
  | "decision-tree"
  | "mindmap"
  | "sequence"
  | "state"
  | string;

interface LayoutConfig {
  rankdir: "TB" | "LR" | "BT" | "RL";
  nodesep: number;
  ranksep: number;
  edgesep: number;
}

const DEFAULT_CONFIG: LayoutConfig = {
  rankdir: "TB",
  nodesep: 80,
  ranksep: 100,
  edgesep: 20,
};

const LAYOUT_CONFIGS: Record<string, LayoutConfig> = {
  flowchart: { rankdir: "TB", nodesep: 80, ranksep: 100, edgesep: 20 },
  "decision-tree": { rankdir: "TB", nodesep: 100, ranksep: 120, edgesep: 30 },
  architecture: { rankdir: "TB", nodesep: 100, ranksep: 150, edgesep: 30 },
  mindmap: { rankdir: "LR", nodesep: 60, ranksep: 150, edgesep: 20 },
  sequence: { rankdir: "LR", nodesep: 120, ranksep: 80, edgesep: 20 },
  state: { rankdir: "LR", nodesep: 80, ranksep: 120, edgesep: 20 },
};

interface PositionedShape extends ShapeElement {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PositionedArrow extends ArrowElement {
  x: number;
  y: number;
  width: number;
  height: number;
  points: [number, number][];
  elbowed: boolean;
}

export interface LayoutedDiagram {
  shapes: PositionedShape[];
  arrows: PositionedArrow[];
}

interface TreeNode {
  id: string;
  children: TreeNode[];
  depth: number;
  angle: number;
  startAngle: number;
  endAngle: number;
}

function buildTree(diagram: Diagram): TreeNode | null {
  const childMap = new Map<string, string[]>();
  const parentSet = new Set<string>();

  for (const arrow of diagram.arrows) {
    const children = childMap.get(arrow.fromId) ?? [];
    children.push(arrow.toId);
    childMap.set(arrow.fromId, children);
    parentSet.add(arrow.toId);
  }

  const roots = diagram.shapes.filter((s) => !parentSet.has(s.id));
  if (roots.length === 0) {
    return null;
  }

  const rootShape = roots[0];
  if (!rootShape) {
    return null;
  }
  const rootId = rootShape.id;

  function buildNode(id: string, depth: number): TreeNode {
    const childIds = childMap.get(id) ?? [];
    return {
      id,
      depth,
      children: childIds.map((cid) => buildNode(cid, depth + 1)),
      angle: 0,
      startAngle: 0,
      endAngle: 0,
    };
  }

  return buildNode(rootId, 0);
}

function assignRadialAngles(
  node: TreeNode,
  startAngle: number,
  endAngle: number
): void {
  node.startAngle = startAngle;
  node.endAngle = endAngle;
  node.angle = (startAngle + endAngle) / 2;

  if (node.children.length === 0) {
    return;
  }

  const sweep = endAngle - startAngle;
  const childSweep = sweep / node.children.length;
  let currentAngle = startAngle;

  for (const child of node.children) {
    assignRadialAngles(child, currentAngle, currentAngle + childSweep);
    currentAngle += childSweep;
  }
}

function applyRadialLayout(diagram: Diagram): LayoutedDiagram {
  const root = buildTree(diagram);
  const layerThickness = 200;
  const centerX = 400;
  const centerY = 400;

  if (!root) {
    return { shapes: [], arrows: [] };
  }

  assignRadialAngles(root, 0, 2 * Math.PI);

  const nodePositions = new Map<string, { x: number; y: number }>();

  function positionNodes(node: TreeNode): void {
    const radius = node.depth * layerThickness;
    const x = centerX + Math.cos(node.angle) * radius;
    const y = centerY + Math.sin(node.angle) * radius;
    nodePositions.set(node.id, { x, y });

    for (const child of node.children) {
      positionNodes(child);
    }
  }

  positionNodes(root);

  const shapeMap = new Map<string, PositionedShape>();
  const positionedShapes: PositionedShape[] = diagram.shapes.map((shape) => {
    const pos = nodePositions.get(shape.id) ?? { x: centerX, y: centerY };
    const width = shape.width ?? 140;
    const height = shape.height ?? 60;
    const positioned: PositionedShape = {
      ...shape,
      x: pos.x - width / 2,
      y: pos.y - height / 2,
      width,
      height,
    };
    shapeMap.set(shape.id, positioned);
    return positioned;
  });

  const positionedArrows: PositionedArrow[] = diagram.arrows.map((arrow) => {
    const startShape = shapeMap.get(arrow.fromId);
    const endShape = shapeMap.get(arrow.toId);

    if (!(startShape && endShape)) {
      return {
        ...arrow,
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        points: [
          [0, 0],
          [100, 0],
        ] as [number, number][],
        elbowed: false,
      };
    }

    const startCx = startShape.x + startShape.width / 2;
    const startCy = startShape.y + startShape.height / 2;
    const endCx = endShape.x + endShape.width / 2;
    const endCy = endShape.y + endShape.height / 2;

    const dx = endCx - startCx;
    const dy = endCy - startCy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;

    const startX = startCx + ux * (startShape.width / 2);
    const startY = startCy + uy * (startShape.height / 2);
    const endX = endCx - ux * (endShape.width / 2);
    const endY = endCy - uy * (endShape.height / 2);

    return {
      ...arrow,
      x: startX,
      y: startY,
      width: endX - startX,
      height: endY - startY,
      points: [
        [0, 0],
        [endX - startX, endY - startY],
      ] as [number, number][],
      elbowed: false,
    };
  });

  return { shapes: positionedShapes, arrows: positionedArrows };
}

function getEdgeConnectionPoint(
  shape: PositionedShape,
  targetShape: PositionedShape,
  isStart: boolean,
  rankdir: string
): { x: number; y: number } {
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  const tcx = targetShape.x + targetShape.width / 2;
  const tcy = targetShape.y + targetShape.height / 2;

  if (rankdir === "TB" || rankdir === "BT") {
    if (isStart) {
      return tcy > cy
        ? { x: cx, y: shape.y + shape.height }
        : { x: cx, y: shape.y };
    }
    return tcy < cy
      ? { x: cx, y: shape.y }
      : { x: cx, y: shape.y + shape.height };
  }

  if (isStart) {
    return tcx > cx
      ? { x: shape.x + shape.width, y: cy }
      : { x: shape.x, y: cy };
  }
  return tcx < cx ? { x: shape.x, y: cy } : { x: shape.x + shape.width, y: cy };
}

function createElbowPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  rankdir: string
): [number, number][] {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  if (rankdir === "TB" || rankdir === "BT") {
    return [
      [0, 0],
      [0, midY - start.y],
      [end.x - start.x, midY - start.y],
      [end.x - start.x, end.y - start.y],
    ];
  }

  return [
    [0, 0],
    [midX - start.x, 0],
    [midX - start.x, end.y - start.y],
    [end.x - start.x, end.y - start.y],
  ];
}

export interface LayoutOverrides {
  direction?: LayoutConfig["rankdir"];
  nodesep?: number;
  ranksep?: number;
  edgesep?: number;
}

export function applyLayout(
  diagram: Diagram,
  chartType: ChartType,
  overrides?: LayoutOverrides
): LayoutedDiagram {
  if (chartType === "mindmap") {
    return applyRadialLayout(diagram);
  }

  const baseConfig = LAYOUT_CONFIGS[chartType] ?? DEFAULT_CONFIG;
  const config: LayoutConfig = {
    ...baseConfig,
    rankdir: overrides?.direction ?? baseConfig.rankdir,
    nodesep: overrides?.nodesep ?? baseConfig.nodesep,
    ranksep: overrides?.ranksep ?? baseConfig.ranksep,
    edgesep: overrides?.edgesep ?? baseConfig.edgesep,
  };
  const useElbow =
    chartType === "architecture" || chartType === "decision-tree";

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: config.rankdir,
    nodesep: config.nodesep,
    ranksep: config.ranksep,
    edgesep: config.edgesep,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const shape of diagram.shapes) {
    g.setNode(shape.id, {
      width: shape.width ?? 180,
      height: shape.height ?? 80,
    });
  }

  for (const arrow of diagram.arrows) {
    g.setEdge(arrow.fromId, arrow.toId);
  }

  dagre.layout(g);

  const shapeMap = new Map<string, PositionedShape>();

  const positionedShapes: PositionedShape[] = diagram.shapes.map((shape) => {
    const node = g.node(shape.id);
    const width = shape.width ?? 180;
    const height = shape.height ?? 80;
    const positioned: PositionedShape = {
      ...shape,
      x: (node?.x ?? 0) - width / 2,
      y: (node?.y ?? 0) - height / 2,
      width,
      height,
    };
    shapeMap.set(shape.id, positioned);
    return positioned;
  });

  const positionedArrows: PositionedArrow[] = diagram.arrows.map((arrow) => {
    const startShape = shapeMap.get(arrow.fromId);
    const endShape = shapeMap.get(arrow.toId);

    if (!(startShape && endShape)) {
      return {
        ...arrow,
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        points: [
          [0, 0],
          [100, 0],
        ],
        elbowed: false,
      };
    }

    const startPoint = getEdgeConnectionPoint(
      startShape,
      endShape,
      true,
      config.rankdir
    );
    const endPoint = getEdgeConnectionPoint(
      endShape,
      startShape,
      false,
      config.rankdir
    );

    const points = useElbow
      ? createElbowPoints(startPoint, endPoint, config.rankdir)
      : ([
          [0, 0],
          [endPoint.x - startPoint.x, endPoint.y - startPoint.y],
        ] as [number, number][]);

    return {
      ...arrow,
      x: startPoint.x,
      y: startPoint.y,
      width: endPoint.x - startPoint.x,
      height: endPoint.y - startPoint.y,
      points,
      elbowed: useElbow,
    };
  });

  return { shapes: positionedShapes, arrows: positionedArrows };
}

export function getLayoutDirection(chartType: string): "TB" | "LR" {
  const config = LAYOUT_CONFIGS[chartType] ?? DEFAULT_CONFIG;
  return config.rankdir === "TB" || config.rankdir === "BT" ? "TB" : "LR";
}
