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
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

function CanvasUnavailable() {
  return (
    <div className="sketchi-excalidraw-scene-canvas__loading" role="alert">
      Canvas unavailable
    </div>
  );
}

// Excalidraw reads browser globals at import time, so the editor module is only
// requested once the canvas renders in the browser.
const LazyExcalidraw = lazy<ComponentType<ExcalidrawProps>>(() =>
  import("@excalidraw/excalidraw").then(
    (module) => ({ default: module.Excalidraw }),
    () => ({ default: CanvasUnavailable }),
  ),
);

const subscribeToNothing = () => () => undefined;
const inBrowser = () => true;
const onServer = () => false;

/** `false` on the server and during hydration, `true` once in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeToNothing, inBrowser, onServer);
}

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
  const hydrated = useHydrated();
  // Excalidraw hands over its API from its constructor, while it renders, so
  // this only records the newest instance. Each scene revision remounts the
  // editor with a fresh API.
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const fittedApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const handleApiChange = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;
      onApiChange?.(api);
    },
    [onApiChange],
  );
  const sceneKey = revision;
  // Excalidraw reports changes only once a mounted editor has loaded its scene.
  // The first change from the current editor fits that scene to the viewport;
  // a discarded or replaced instance never matches the current API's state.
  const handleChange: NonNullable<ExcalidrawProps["onChange"]> = useCallback(
    (elements, appState, files) => {
      const api = apiRef.current;
      if (
        api &&
        fittedApiRef.current !== api &&
        api.getAppState() === appState
      ) {
        fittedApiRef.current = api;
        api.scrollToContent(undefined, {
          animate: false,
          fitToViewport: true,
          viewportZoomFactor: 1,
        });
      }
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

  const loadingCanvas = (
    <div className="sketchi-excalidraw-scene-canvas__loading">
      Loading canvas
    </div>
  );

  return (
    <section
      aria-label={title}
      className="sketchi-excalidraw-scene-canvas"
      data-view-mode={viewModeEnabled}
      data-testid="excalidraw-scene-canvas"
    >
      {hydrated ? (
        <Suspense fallback={loadingCanvas}>
          <LazyExcalidraw
            key={sceneKey}
            onChange={handleChange}
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
        </Suspense>
      ) : (
        loadingCanvas
      )}
    </section>
  );
}
