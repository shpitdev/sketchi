import dagre from "dagre";
import {
  DEFAULT_DIAGRAM_TYPE,
  type DiagramType,
  type GraphLayout,
  type IntermediateFormat,
} from "./diagram-intermediate";
import type { Diagram } from "./diagram-structure";
import type {
  LayoutConfig,
  LayoutDirection,
  LayoutOverrides,
  LayoutedDiagram,
  PositionedArrow,
  PositionedShape,
} from "./diagram-layout-types";
import { applyRadialLayout } from "./diagram-layout-radial";
import {
  convertIntermediateToDiagram,
  toLayoutOverrides,
} from "./diagram-layout-intermediate";
import { sortArrows, sortShapes } from "./diagram-layout-sorting";

export type {
  EdgeRouting,
  LayoutDirection,
  LayoutOverrides,
  LayoutedDiagram,
} from "./diagram-layout-types";
export { convertIntermediateToDiagram, toLayoutOverrides } from "./diagram-layout-intermediate";

const DEFAULT_CONFIG: LayoutConfig = {
  rankdir: "TB",
  nodesep: 80,
  ranksep: 100,
  edgesep: 20,
  edgeRouting: "straight",
};

const LAYOUT_CONFIGS: Record<string, LayoutConfig> = {
  flowchart: {
    rankdir: "TB",
    nodesep: 80,
    ranksep: 100,
    edgesep: 20,
    edgeRouting: "straight",
  },
  "decision-tree": {
    rankdir: "TB",
    nodesep: 100,
    ranksep: 120,
    edgesep: 30,
    edgeRouting: "elbow",
  },
  architecture: {
    rankdir: "TB",
    nodesep: 100,
    ranksep: 150,
    edgesep: 30,
    edgeRouting: "elbow",
  },
  mindmap: {
    rankdir: "LR",
    nodesep: 60,
    ranksep: 150,
    edgesep: 20,
    edgeRouting: "straight",
  },
  sequence: {
    rankdir: "LR",
    nodesep: 120,
    ranksep: 80,
    edgesep: 20,
    edgeRouting: "straight",
  },
  state: {
    rankdir: "LR",
    nodesep: 80,
    ranksep: 120,
    edgesep: 20,
    edgeRouting: "straight",
  },
};

function getEdgeConnectionPoint(
  shape: PositionedShape,
  targetShape: PositionedShape,
  isStart: boolean,
  rankdir: LayoutDirection
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
  rankdir: LayoutDirection
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

function resolveLayoutConfig(
  diagramType: string,
  overrides?: LayoutOverrides
): LayoutConfig {
  const baseConfig = LAYOUT_CONFIGS[diagramType] ?? DEFAULT_CONFIG;
  return {
    ...baseConfig,
    rankdir: overrides?.direction ?? baseConfig.rankdir,
    nodesep: overrides?.nodesep ?? baseConfig.nodesep,
    ranksep: overrides?.ranksep ?? baseConfig.ranksep,
    edgesep: overrides?.edgesep ?? baseConfig.edgesep,
    edgeRouting: overrides?.edgeRouting ?? baseConfig.edgeRouting,
  };
}

export function applyLayout(
  diagram: Diagram,
  diagramType: string,
  overrides?: LayoutOverrides
): LayoutedDiagram {
  const config = resolveLayoutConfig(diagramType, overrides);
  if (diagramType === "mindmap") {
    return applyRadialLayout(diagram);
  }

  const shapes = sortShapes(diagram.shapes);
  const arrows = sortArrows(diagram.arrows);
  const useElbow = config.edgeRouting === "elbow";

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: config.rankdir,
    nodesep: config.nodesep,
    ranksep: config.ranksep,
    edgesep: config.edgesep,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const shape of shapes) {
    g.setNode(shape.id, {
      width: shape.width ?? 180,
      height: shape.height ?? 80,
    });
  }

  for (const [index, arrow] of arrows.entries()) {
    const edgeName = arrow.id ?? `edge_${index}`;
    g.setEdge(arrow.fromId, arrow.toId, {}, edgeName);
  }

  dagre.layout(g);

  const shapeMap = new Map<string, PositionedShape>();

  const positionedShapes: PositionedShape[] = shapes.map((shape) => {
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

  const positionedArrows: PositionedArrow[] = arrows.map((arrow) => {
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

export function layoutIntermediateDiagram(intermediate: IntermediateFormat): {
  diagram: Diagram;
  layouted: LayoutedDiagram;
  diagramType: DiagramType;
  layoutOverrides?: LayoutOverrides;
} {
  const diagram = convertIntermediateToDiagram(intermediate);
  const diagramType =
    intermediate.graphOptions?.diagramType ?? DEFAULT_DIAGRAM_TYPE;
  const layoutOverrides = toLayoutOverrides(intermediate);
  const layouted = applyLayout(diagram, diagramType, layoutOverrides);

  return {
    diagram,
    layouted,
    diagramType,
    layoutOverrides,
  };
}

export function getLayoutDirection(diagramType: string): "TB" | "LR" {
  const config = resolveLayoutConfig(diagramType);
  return config.rankdir === "TB" || config.rankdir === "BT" ? "TB" : "LR";
}

export type DiagramLayoutConfig = LayoutConfig;
export type DiagramLayoutOverrides = LayoutOverrides;
export type DiagramLayoutDirection = GraphLayout["direction"];
