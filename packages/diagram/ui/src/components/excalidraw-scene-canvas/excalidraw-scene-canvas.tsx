import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawScene } from "@sketchi/diagram-excalidraw";
import { SKETCHI_DIAGRAM_PALETTE } from "@sketchi/diagram-core";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type ExcalidrawComponent = ComponentType<ExcalidrawProps>;

export interface ExcalidrawCanvasScene {
  readonly appState: Record<string, unknown>;
  readonly elements: readonly (
    | ExcalidrawElement
    | ExcalidrawScene["elements"][number]
  )[];
}

export interface ExcalidrawSceneCanvasProps {
  onApiChange?: (api: ExcalidrawImperativeAPI) => void;
  onChange?: ExcalidrawProps["onChange"];
  revision?: number | string;
  scene: ExcalidrawCanvasScene;
  title: string;
  viewModeEnabled?: boolean;
  zenModeEnabled?: boolean;
}

export function ExcalidrawSceneCanvas({
  onApiChange,
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
  const handleApiChange = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      setExcalidrawApi(api);
      onApiChange?.(api);
    },
    [onApiChange],
  );
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
          : SKETCHI_DIAGRAM_PALETTE.card,
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
        viewportZoomFactor: 1,
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
      data-view-mode={viewModeEnabled}
      data-testid="excalidraw-scene-canvas"
    >
      {Excalidraw ? (
        <Excalidraw
          key={sceneKey}
          {...(onChange ? { onChange } : {})}
          autoFocus={false}
          excalidrawAPI={handleApiChange}
          gridModeEnabled={false}
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
          Loading canvas
        </div>
      )}
    </section>
  );
}
