import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawScene } from "@sketchi/diagram-excalidraw";
import { type ComponentType, useEffect, useMemo, useState } from "react";

type ExcalidrawComponent = ComponentType<ExcalidrawProps>;

export interface ExcalidrawSceneCanvasProps {
  onChange?: ExcalidrawProps["onChange"];
  revision?: number | string;
  scene: ExcalidrawScene;
  title: string;
  viewModeEnabled?: boolean;
  zenModeEnabled?: boolean;
}

export function ExcalidrawSceneCanvas({
  onChange,
  revision = "scene",
  scene,
  title,
  viewModeEnabled = false,
  zenModeEnabled = true,
}: ExcalidrawSceneCanvasProps) {
  const [Excalidraw, setExcalidraw] = useState<ExcalidrawComponent | null>(
    null,
  );
  const [excalidrawApi, setExcalidrawApi] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const sceneKey = useMemo(
    () =>
      JSON.stringify({
        appState: scene.appState,
        elements: scene.elements.map((element) => ({
          containerId: "containerId" in element ? element.containerId : null,
          height: element.height,
          id: element.id,
          points: "points" in element ? element.points : null,
          text: "text" in element ? element.text : null,
          type: element.type,
          width: element.width,
          x: element.x,
          y: element.y,
        })),
        revision,
      }),
    [revision, scene],
  );
  const initialData = useMemo<ExcalidrawInitialDataState>(() => {
    const elements = scene.elements as unknown as NonNullable<
      ExcalidrawInitialDataState["elements"]
    >;
    const appState = {
      ...scene.appState,
      viewBackgroundColor:
        typeof scene.appState.viewBackgroundColor === "string"
          ? scene.appState.viewBackgroundColor
          : "#ffffff",
    } as NonNullable<ExcalidrawInitialDataState["appState"]>;

    return {
      elements,
      appState,
      scrollToContent: true,
    };
  }, [scene]);

  useEffect(() => {
    let mounted = true;

    import("@excalidraw/excalidraw").then((module) => {
      if (mounted) {
        setExcalidraw(() => module.Excalidraw);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!excalidrawApi) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      excalidrawApi.scrollToContent(undefined, {
        animate: false,
        fitToViewport: true,
        viewportZoomFactor: 0.72,
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [excalidrawApi, sceneKey]);

  return (
    <section
      aria-label={title}
      className="sketchi-excalidraw-scene-canvas"
      data-testid="excalidraw-scene-canvas"
    >
      {Excalidraw ? (
        <Excalidraw
          key={sceneKey}
          {...(onChange ? { onChange } : {})}
          autoFocus={false}
          excalidrawAPI={setExcalidrawApi}
          gridModeEnabled
          initialData={initialData}
          name={title}
          theme="light"
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveAsImage: true,
            },
          }}
          viewModeEnabled={viewModeEnabled}
          zenModeEnabled={zenModeEnabled}
        />
      ) : (
        <div className="sketchi-excalidraw-scene-canvas__loading">
          Loading Excalidraw
        </div>
      )}
    </section>
  );
}
