import type { ExcalidrawProps } from "@excalidraw/excalidraw/types";
import {
  convertSceneToExcalidraw,
  type ExcalidrawElement,
  type ExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { useCallback, useMemo } from "react";

import { ExcalidrawSceneCanvas } from "../excalidraw-scene-canvas/index.js";

export type ArtifactCanvasMode = "edit" | "view";

export interface ArtifactCanvasProps {
  mode?: ArtifactCanvasMode;
  onSceneChange?: (scene: ExcalidrawScene) => void;
  revision?: number | string;
  scene: RenderedDiagramScene;
  title?: string;
}

function pickExcalidrawAppState(appState: Record<string, unknown>) {
  return {
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    selectedElementIds: appState.selectedElementIds,
    viewBackgroundColor: appState.viewBackgroundColor,
    zoom: appState.zoom,
  };
}

function sceneFromExcalidrawChange(
  elements: readonly unknown[],
  appState: Record<string, unknown>,
): ExcalidrawScene {
  return {
    appState: pickExcalidrawAppState(appState),
    elements: elements as ExcalidrawElement[],
  };
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
  const handleChange: NonNullable<ExcalidrawProps["onChange"]> = useCallback(
    (elements, appState) => {
      if (!onSceneChange) {
        return;
      }

      onSceneChange(
        sceneFromExcalidrawChange(
          elements,
          appState as unknown as Record<string, unknown>,
        ),
      );
    },
    [onSceneChange],
  );

  return (
    <div className="sketchi-artifact-canvas" data-mode={mode}>
      <ExcalidrawSceneCanvas
        {...(editable && onSceneChange ? { onChange: handleChange } : {})}
        {...(revision === undefined ? {} : { revision })}
        scene={excalidrawScene}
        title={title}
        viewModeEnabled={!editable}
        zenModeEnabled={!editable}
      />
    </div>
  );
}
