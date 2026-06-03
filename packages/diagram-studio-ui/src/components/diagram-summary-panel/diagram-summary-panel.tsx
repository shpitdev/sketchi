import {
  type IntermediateDiagram,
  validateIntermediateDiagram,
} from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import {
  type DiagramRenderStatus,
  DiagramStatusStrip,
} from "../diagram-status-strip";

export interface DiagramSummaryPanelProps {
  diagram: IntermediateDiagram;
  prompt: string;
  status: DiagramRenderStatus;
  title?: string;
}

export function DiagramSummaryPanel({
  diagram,
  prompt,
  status,
  title = "Sketchi v2",
}: DiagramSummaryPanelProps) {
  const validation = validateIntermediateDiagram(diagram);
  const scene = renderIntermediateDiagram(diagram);

  return (
    <section aria-label="Diagram summary" className="sketchi-summary-panel">
      <DiagramStatusStrip
        edgeCount={scene.stats.edgeCount}
        nodeCount={scene.stats.nodeCount}
        status={status}
      />
      <h1>{title}</h1>
      <p>{prompt}</p>
      <div className="sketchi-summary-panel__issues">
        {validation.ok
          ? "Intermediate contract valid"
          : validation.issues.map((issue) => issue.message).join(" ")}
      </div>
    </section>
  );
}
