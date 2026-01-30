/**
 * Sequence diagram template
 *
 * Left-to-right layout optimized for message flows between participants.
 * Uses green color scheme for clarity.
 */

import type { DiagramTemplate } from "./flowchart";

export const SequenceTemplate: DiagramTemplate = {
  diagramType: "sequence",
  layout: {
    direction: "LR",
    nodesep: 120,
    ranksep: 80,
    edgeRouting: "straight",
  },
  nodeDefaults: {
    shapeType: "rectangle",
    width: 120,
    height: 60,
    fill: "#b2f2bb",
    stroke: "#40c057",
  },
  edgeDefaults: {
    stroke: "#40c057",
    arrowhead: "arrow",
  },
  kindToShapeMap: {
    participant: "rectangle",
    lifeline: "rectangle",
    activation: "rectangle",
  },
};
