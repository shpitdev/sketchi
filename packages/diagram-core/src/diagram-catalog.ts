import { architectureFixture } from "./diagram-types/architecture";
import { flowchartFixture } from "./diagram-types/flowchart";
import type { IntermediateDiagram } from "./intermediate";

export interface DiagramCatalogEntry {
  description: string;
  diagram: IntermediateDiagram;
  id: string;
  label: string;
  prompt: string;
}

export const generatedDiagramCatalog = [
  {
    description: "Package-first app, worker, data, and AI boundaries",
    diagram: architectureFixture,
    id: "architecture",
    label: "Architecture",
    prompt:
      "Show the package-first v2 architecture with app, worker, data, and AI boundaries.",
  },
  {
    description: "Left-to-right generation flow contract",
    diagram: flowchartFixture,
    id: "flowchart",
    label: "Flowchart",
    prompt:
      "Show the prompt-to-diagram generation flow as maintained packages.",
  },
] satisfies DiagramCatalogEntry[];
