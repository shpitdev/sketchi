import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

import { ArtifactCanvas } from "../artifact-canvas/index.js";

export interface DiagramPreviewProps {
  scene: RenderedDiagramScene;
}

export function DiagramPreview({ scene }: DiagramPreviewProps) {
  return (
    <div className="sketchi-diagram-preview">
      <ArtifactCanvas mode="view" scene={scene} />
    </div>
  );
}
