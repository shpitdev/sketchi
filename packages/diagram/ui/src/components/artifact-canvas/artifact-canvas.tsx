import {
  convertSceneToExcalidraw,
  type ExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { useMemo } from "react";

import { ExcalidrawSceneCanvas } from "../excalidraw-scene-canvas/index.js";

export type ArtifactCanvasMode = "edit" | "view";

export interface ArtifactCanvasProps {
  mode?: ArtifactCanvasMode;
  onSceneChange?: (scene: ExcalidrawScene) => void;
  revision?: number | string;
  scene: RenderedDiagramScene;
  title?: string;
}

export function ArtifactCanvas({
  mode = "view",
  onSceneChange,
  revision,
  scene,
  title = scene.title,
}: ArtifactCanvasProps) {
  const editable = mode === "edit";
  const excalidrawScene = useMemo(
    () => convertSceneToExcalidraw(scene),
    [scene],
  );
  // Source scenes are immutable inputs, not the editor's live change stream.
  const sceneRevision = useMemo(
    () => revision ?? JSON.stringify(scene),
    [revision, scene],
  );
  return (
    <div className="sketchi-artifact-canvas" data-mode={mode}>
      <ExcalidrawSceneCanvas
        {...(editable && onSceneChange ? { onSceneChange } : {})}
        revision={sceneRevision}
        scene={excalidrawScene}
        title={title}
        viewModeEnabled={!editable}
        zenModeEnabled={!editable}
      />
    </div>
  );
}
