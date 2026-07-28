import { flowchartFixture } from "./types/flowchart.js";
import { mindmapFixture } from "./types/mindmap.js";
import { parseIntermediateDiagram } from "./intermediate.js";

export const diagramFixtures = [
  parseIntermediateDiagram(flowchartFixture),
  parseIntermediateDiagram(mindmapFixture),
];
