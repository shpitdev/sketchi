import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

import { ExcalidrawSceneCanvas } from "../excalidraw-scene-canvas/index.js";

export interface DiagramPreviewProps {
  scene: RenderedDiagramScene;
}

export function DiagramPreview({ scene }: DiagramPreviewProps) {
  const excalidrawScene = convertSceneToExcalidraw(scene);

  return (
    <div className="sketchi-diagram-preview">
      <ExcalidrawSceneCanvas scene={excalidrawScene} title={scene.title} />
    </div>
  );
}
