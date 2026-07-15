import {
  type IntermediateDiagram,
  parseFlowchartDiagram,
  validateIntermediateDiagram
} from "@sketchi/diagram-core";
import {
  convertSceneToExcalidraw,
  validateExcalidrawScene
} from "@sketchi/diagram-excalidraw";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import { DiagramPreview } from "../diagram-preview/index.js";
import { FlowchartValidationPanel } from "../flowchart-validation-panel/index.js";

export interface GenerationWorkspaceProps {
  diagram: IntermediateDiagram;
  status?: "idle" | "generating" | "ready" | "error";
}

const statusLabels = {
  idle: "Idle",
  generating: "Generating",
  ready: "Ready",
  error: "Needs attention"
};

export function GenerationWorkspace({
  diagram,
  status = "ready"
}: GenerationWorkspaceProps) {
  let validationMessage = "Validated diagram IR";

  try {
    if (diagram.type === "flowchart") {
      parseFlowchartDiagram(diagram);
      validationMessage = "Validated flowchart IR";
    } else {
      validateIntermediateDiagram(diagram);
    }
  } catch (error) {
    validationMessage =
      error instanceof Error ? error.message : "Diagram validation failed";
  }

  const scene = renderIntermediateDiagram(diagram);
  const realSceneValidation = validateExcalidrawScene(
    convertSceneToExcalidraw(scene)
  );
  const realSceneIssueCount = realSceneValidation.issues.length;
  const realSceneMessage =
    realSceneIssueCount === 0
      ? "All arrows are bound"
      : `${realSceneIssueCount} real-scene issues`;

  return (
    <section className="sketchi-generation-workspace">
      <header className="sketchi-generation-workspace__header">
        <div>
          <p className="sketchi-generation-workspace__eyebrow">Sketchi v2</p>
          <h1>{diagram.title}</h1>
        </div>
        <span className="sketchi-generation-workspace__status">
          {statusLabels[status]}
        </span>
      </header>

      <FlowchartValidationPanel
        edgeCount={diagram.edges.length}
        intermediateMessage={validationMessage}
        nodeCount={diagram.nodes.length}
        realSceneIssueCount={realSceneIssueCount}
        realSceneMessage={realSceneMessage}
      />

      <DiagramPreview scene={scene} />
    </section>
  );
}
