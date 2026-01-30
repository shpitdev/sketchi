/**
 * Architecture diagram template
 *
 * Optimized for system architecture with wider spacing and elbow routing.
 * Uses purple color scheme for component distinction.
 */

import type { DiagramTemplate } from "./flowchart";

export const ArchitectureTemplate: DiagramTemplate = {
  diagramType: "architecture",
  layout: {
    direction: "TB",
    nodesep: 100,
    ranksep: 150,
    edgeRouting: "elbow",
  },
  nodeDefaults: {
    shapeType: "rectangle",
    width: 200,
    height: 100,
    fill: "#d0bfff",
    stroke: "#7950f2",
  },
  edgeDefaults: {
    stroke: "#7950f2",
    arrowhead: "arrow",
  },
  kindToShapeMap: {
    component: "rectangle",
    database: "rectangle",
    service: "rectangle",
    client: "ellipse",
    external: "ellipse",
    actor: "ellipse",
  },
};
