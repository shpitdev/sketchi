import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

import { ArtifactCanvas } from "../artifact-canvas/index.js";

export interface DiagramPreviewProps {
  revision?: number | string;
  scene: RenderedDiagramScene;
}

export function DiagramPreview({ revision, scene }: DiagramPreviewProps) {
  return (
    <div className="sketchi-diagram-preview">
      <ArtifactCanvas
        mode="view"
        {...(revision === undefined ? {} : { revision })}
        scene={scene}
      />
    </div>
  );
}
