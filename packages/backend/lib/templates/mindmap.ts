/**
 * Mindmap diagram template
 *
 * Left-to-right layout with ellipse shapes and no arrowheads.
 * Uses orange color scheme for visibility and warmth.
 */

import type { DiagramTemplate } from "./flowchart";

export const MindmapTemplate: DiagramTemplate = {
  diagramType: "mindmap",
  layout: {
    direction: "LR",
    nodesep: 60,
    ranksep: 150,
    edgeRouting: "straight",
  },
  nodeDefaults: {
    shapeType: "ellipse",
    width: 150,
    height: 60,
    fill: "#ffc078",
    stroke: "#fd7e14",
  },
  edgeDefaults: {
    stroke: "#fd7e14",
    arrowhead: null,
  },
  kindToShapeMap: {
    root: "ellipse",
    topic: "ellipse",
    subtopic: "ellipse",
  },
};
