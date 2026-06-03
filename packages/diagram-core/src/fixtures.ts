import { architectureFixture } from "./diagram-types/architecture";
import { flowchartFixture } from "./diagram-types/flowchart";

export const diagramFixtures = {
  architecture: architectureFixture,
  flowchart: flowchartFixture,
} as const;
