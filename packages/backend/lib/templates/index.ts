export { ArchitectureTemplate } from "./architecture";
export type { DiagramTemplate } from "./flowchart";
export { FlowchartTemplate } from "./flowchart";
export { MindmapTemplate } from "./mindmap";
export { SequenceTemplate } from "./sequence";

import { ArchitectureTemplate } from "./architecture";
import type { DiagramTemplate } from "./flowchart";
import { FlowchartTemplate } from "./flowchart";
import { MindmapTemplate } from "./mindmap";
import { SequenceTemplate } from "./sequence";

const TEMPLATES: Record<string, DiagramTemplate> = {
  flowchart: FlowchartTemplate,
  architecture: ArchitectureTemplate,
  mindmap: MindmapTemplate,
  sequence: SequenceTemplate,
};

// biome-ignore lint/performance/noBarrelFile: shared template entrypoint
export function getTemplateForType(diagramType?: string): DiagramTemplate {
  if (!diagramType) {
    return FlowchartTemplate;
  }
  return TEMPLATES[diagramType.toLowerCase()] ?? FlowchartTemplate;
}
