/**
 * Flowchart diagram template
 *
 * Defines layout, node defaults, edge defaults, and kind-to-shape mappings
 * for flowchart-type diagrams.
 */

export interface DiagramTemplate {
  diagramType: string;
  layout: {
    direction: "TB" | "LR" | "BT" | "RL";
    nodesep: number;
    ranksep: number;
    edgeRouting: "straight" | "elbow";
  };
  nodeDefaults: {
    shapeType: "rectangle" | "ellipse" | "diamond";
    width: number;
    height: number;
    fill: string;
    stroke: string;
  };
  edgeDefaults: {
    stroke: string;
    arrowhead: "arrow" | null;
  };
  kindToShapeMap: Record<string, "rectangle" | "ellipse" | "diamond">;
}

export const FlowchartTemplate: DiagramTemplate = {
  diagramType: "flowchart",
  layout: {
    direction: "TB",
    nodesep: 80,
    ranksep: 100,
    edgeRouting: "straight",
  },
  nodeDefaults: {
    shapeType: "rectangle",
    width: 180,
    height: 80,
    fill: "#a5d8ff",
    stroke: "#1971c2",
  },
  edgeDefaults: {
    stroke: "#1971c2",
    arrowhead: "arrow",
  },
  kindToShapeMap: {
    start: "ellipse",
    end: "ellipse",
    decision: "diamond",
    process: "rectangle",
  },
};
