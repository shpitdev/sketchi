import { flowchartFixture } from "./diagram-types/flowchart.js";
import { mindmapFixture } from "./diagram-types/mindmap.js";
import { parseIntermediateDiagram } from "./intermediate.js";

export const diagramFixtures = [
  parseIntermediateDiagram(flowchartFixture),
  parseIntermediateDiagram(mindmapFixture),
];
