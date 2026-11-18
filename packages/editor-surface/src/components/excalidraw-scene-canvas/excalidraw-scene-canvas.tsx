import { createBranchLabelSynchronizer } from "./branch-labels";
import { measureCanvasControls, canvasFit } from "./canvas-fit";
import { createFoldedRouteRelease } from "./route-release";

import {
	type BinaryFiles,
	type ExcalidrawImperativeAPI,
	type ExcalidrawInitialDataState,
	type ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import { type ExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { SKETCHI_DIAGRAM_PALETTE } from "@sketchi/drawing";
import { loadExcalidraw } from "../../lib/load-excalidraw";
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
// The loaded module also measures scene bounds for the initial fit.
let sceneBounds: typeof import("@excalidraw/excalidraw").getCommonBounds | undefined;
// And its mutateElement has Excalidraw route an arrow a drag releases.
let mutateElement: typeof import("@excalidraw/excalidraw").mutateElement | undefined;

const LazyExcalidraw = lazy<ComponentType<ExcalidrawProps>>(() =>
	loadExcalidraw().then(
		(module) => {
			sceneBounds = module.getCommonBounds;
			mutateElement = module.mutateElement;
			return { default: module.Excalidraw };
		},
		() => ({ default: CanvasUnavailable }),
	),
);

/**
 * The exact fit of a diagram, clear of Excalidraw's menu and zoom
 * controls, or `undefined` before the scene's bounds can be measured.
 */
function fitScene(
	root: HTMLElement | null,
	elements: Parameters<NonNullable<ExcalidrawProps["onChange"]>>[0],
	appState: Parameters<NonNullable<ExcalidrawProps["onChange"]>>[1],
) {
	const visible = elements.filter((element) => !element.isDeleted);
	if (!root || !sceneBounds || visible.length === 0) return undefined;
	const [x1, y1, x2, y2] = sceneBounds(visible);
	return canvasFit(
		appState,
		{ height: y2 - y1, width: x2 - x1 },
		measureCanvasControls(root, appState),
	);
}

const subscribeToNothing = () => () => undefined;
const inBrowser = () => true;
const onServer = () => false;

/** `false` on the server and during hydration, `true` once in the browser. */
function useHydrated(): boolean {
	return useSyncExternalStore(subscribeToNothing, inBrowser, onServer);
}

export interface DrawingEditorProps {
	onApiChange?: (api: ExcalidrawImperativeAPI) => void;
	onChange?: ExcalidrawProps["onChange"];
	onSceneChange?: (scene: ExcalidrawScene) => void;
	revision?: number | string;
	scene: ExcalidrawScene;
	/** Excalidraw's dark theme inverts the canvas and the SVG marks on it. */
	theme?: "dark" | "light";
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
	files: Parameters<ExcalidrawChange>[2],
): ExcalidrawScene {
	return {
		appState: pickExcalidrawAppState(appState),
		// One adapter owns the native editor -> serializable scene type boundary.
		elements,
		files,
	};
}

export function DrawingEditor({
	onApiChange,
	onChange,
	onSceneChange,
	revision = "scene",
	scene,
	theme = "light",
	title,
	viewModeEnabled = false,
	zenModeEnabled = true,
}: DrawingEditorProps) {
	const hydrated = useHydrated();
	const rootRef = useRef<HTMLElement | null>(null);
	// Excalidraw hands over its API from its constructor, while it renders, so
	// this only records the newest instance. Each scene revision remounts the
	// editor with a fresh API.
	const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
	const fittedRef = useRef<{
		readonly api: ExcalidrawImperativeAPI;
		readonly height: number;
		readonly width: number;
	} | null>(null);
	const synchronizeLabels = useRef(createBranchLabelSynchronizer());
	const releaseRoutes = useRef<ReturnType<typeof createFoldedRouteRelease> | undefined>(undefined);
	const handleApiChange = useCallback(
		(api: ExcalidrawImperativeAPI) => {
			if (apiRef.current !== api) {
				synchronizeLabels.current = createBranchLabelSynchronizer();
				releaseRoutes.current = mutateElement ? createFoldedRouteRelease(mutateElement) : undefined;
			}
			apiRef.current = api;
			onApiChange?.(api);
		},
		[onApiChange],
	);
	const sceneKey = revision;
	// Excalidraw reports changes only once a mounted editor has loaded its scene.
	// The first change from the current editor fits that scene to the viewport;
	// a discarded or replaced instance never matches the current API's state.
	// A read-only canvas refits when its viewport resizes, while an editable one
	// keeps the camera the user chose.
	const handleChange: NonNullable<ExcalidrawProps["onChange"]> = useCallback(
		(elements, appState, files) => {
			const api = apiRef.current;
			if (api && api.getAppState() === appState) {
				const fitted = fittedRef.current;
				const resized =
					fitted?.api === api &&
					(fitted.width !== appState.width || fitted.height !== appState.height);
				if (fitted?.api !== api || (viewModeEnabled && resized)) {
					fittedRef.current = { api, height: appState.height, width: appState.width };
					const fit = fitScene(rootRef.current, elements, appState);
					// Excalidraw rounds a fit's zoom down to a tenth and then clamps it to
					// minZoom and maxZoom, so pinning both keeps the exact zoom.
					api.scrollToContent(undefined, {
						animate: false,
						fitToViewport: true,
						viewportZoomFactor: 1,
						...(fit
							? { canvasOffsets: fit.canvasOffsets, maxZoom: fit.zoom, minZoom: fit.zoom }
							: {}),
					});
				}
			}
			const labeled = synchronizeLabels.current(elements);
			if (api && labeled !== elements) api.updateScene({ elements: labeled });
			const synchronized =
				api && releaseRoutes.current
					? releaseRoutes.current(api, labeled, appState.selectedElementIds)
					: labeled;
			onChange?.(synchronized, appState, files);
			onSceneChange?.(sceneFromExcalidrawChange(synchronized, appState, files));
		},
		[onChange, onSceneChange, viewModeEnabled],
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
			// Files ship with the first frame so logos paint without a reload.
			...(scene.files ? { files: scene.files as unknown as BinaryFiles } : {}),
			scrollToContent: true,
		};
	}, [scene]);

	const loadingCanvas = (
		<div className="sketchi-excalidraw-scene-canvas__loading">Loading canvas</div>
	);

	return (
		<section
			aria-label={title}
			className="sketchi-excalidraw-scene-canvas"
			ref={rootRef}
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
						theme={theme}
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
