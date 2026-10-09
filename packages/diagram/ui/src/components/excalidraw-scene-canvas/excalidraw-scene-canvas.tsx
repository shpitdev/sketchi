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
    ExcalidrawElement | ExcalidrawScene["elements"][number]
  )[];
}

export interface ExcalidrawSceneCanvasProps {
  onApiChange?: (api: ExcalidrawImperativeAPI) => void;
  onChange?: ExcalidrawProps["onChange"];
  onSceneChange?: (scene: ExcalidrawScene) => void;
  revision?: number | string;
  scene: ExcalidrawCanvasScene;
  title: string;
  viewModeEnabled?: boolean;
  zenModeEnabled?: boolean;
}

type ExcalidrawChange = NonNullable<ExcalidrawProps["onChange"]>;

function pickExcalidrawAppState(appState: Parameters<ExcalidrawChange>[1]) {
  return {
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    selectedElementIds: appState.selectedElementIds,
    viewBackgroundColor: appState.viewBackgroundColor,
    zoom: appState.zoom,
  };
}

function sceneFromExcalidrawChange(
  elements: Parameters<ExcalidrawChange>[0],
  appState: Parameters<ExcalidrawChange>[1],
): ExcalidrawScene {
  return {
    appState: pickExcalidrawAppState(appState),
    // One adapter owns the native editor -> serializable scene type boundary.
    elements: elements as unknown as ExcalidrawScene["elements"],
  };
}

export function ExcalidrawSceneCanvas({
  onApiChange,
  onChange,
  onSceneChange,
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
  const sceneKey = revision;
  const handleChange: NonNullable<ExcalidrawProps["onChange"]> = useCallback(
    (elements, appState, files) => {
      onChange?.(elements, appState, files);
      onSceneChange?.(sceneFromExcalidrawChange(elements, appState));
    },
    [onChange, onSceneChange],
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
          {...(onChange || onSceneChange ? { onChange: handleChange } : {})}
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
