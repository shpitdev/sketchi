import type {
	AppState,
	ExcalidrawImperativeAPI,
	ExcalidrawInitialDataState,
	ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import { type ComponentType, useCallback, useRef } from "react";

import {
	type Camera,
	cameraBetween,
	cameraBetweenToolbars,
	imageCamera,
	toolbarInsets,
} from "./home-diagram-camera.js";
import { HOME_DIAGRAM } from "./home-diagram-data.js";

export interface HomeDiagramEditorProps {
	/** Excalidraw's editor, from diagram-ui's loader. */
	Excalidraw: ComponentType<ExcalidrawProps>;
	/** The committed .excalidraw file, parsed. */
	scene: ExcalidrawInitialDataState;
	/** Rendered width of the image this editor replaces. */
	width: number;
}

/** How long the drawing takes to settle clear of the toolbars. */
const SETTLE_MS = 320;

/**
 * Excalidraw itself, opened on the home diagram. It starts at the image's own
 * zoom and position, so nothing jumps, then eases the drawing into the space
 * its toolbars leave free, so every box is in view.
 */
export function HomeDiagramEditor({ Excalidraw, scene, width }: HomeDiagramEditorProps) {
	const frameElement = useRef<HTMLDivElement | null>(null);
	const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
	const settle = useRef<{ started: boolean; cancel: () => void }>({
		started: false,
		cancel: () => undefined,
	});
	const start = imageCamera(width);

	// Excalidraw reports its first change once the scene is loaded; a frame later its
	// toolbars are laid out and can be measured.
	const onChange = useCallback(() => {
		const api = apiRef.current;
		const frame = frameElement.current;
		if (settle.current.started || !api || !frame) return;
		settle.current.started = true;
		const measure = requestAnimationFrame(() => {
			const box = frame.getBoundingClientRect();
			const target = cameraBetweenToolbars(box.width, box.height, toolbarInsets(frame));
			settle.current.cancel = moveCamera(api, imageCamera(width), target, frame);
		});
		settle.current.cancel = () => cancelAnimationFrame(measure);
	}, [width]);
	// Reset remounts the editor; a move still running stops with the old one.
	const frameRef = useCallback((frame: HTMLDivElement | null) => {
		frameElement.current = frame;
		return () => settle.current.cancel();
	}, []);

	return (
		<div className="home-diagram__frame" ref={frameRef}>
			<Excalidraw
				excalidrawAPI={(api) => {
					apiRef.current = api;
				}}
				initialData={{
					...scene,
					appState: {
						...scene.appState,
						scrollX: start.scrollX,
						scrollY: start.scrollY,
						zoom: { value: start.zoom },
					} as NonNullable<ExcalidrawInitialDataState["appState"]>,
				}}
				name={HOME_DIAGRAM.title}
				onChange={onChange}
				UIOptions={{
					canvasActions: {
						changeViewBackgroundColor: false,
						clearCanvas: false,
						export: { saveFileToDisk: true },
						loadScene: false,
						saveAsImage: true,
						saveToActiveFile: false,
						toggleTheme: false,
					},
					// Pictures added here would only live in this tab; without the tool the
					// toolbar also fits a phone.
					tools: { image: false },
				}}
			/>
		</div>
	);
}

/**
 * Eases Excalidraw's camera from `from` to `to`, or jumps there when the
 * visitor prefers less motion. A press on the canvas stops it, so the move
 * never fights the visitor. Returns a function that stops it.
 */
function moveCamera(
	api: ExcalidrawImperativeAPI,
	from: Camera,
	to: Camera,
	frame: HTMLElement,
): () => void {
	const show = ({ scrollX, scrollY, zoom }: Camera) =>
		api.updateScene({
			appState: { scrollX, scrollY, zoom: { value: zoom as AppState["zoom"]["value"] } },
		});
	if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
		show(to);
		return () => undefined;
	}
	let frameId = 0;
	const stop = () => {
		cancelAnimationFrame(frameId);
		frame.removeEventListener("pointerdown", stop);
	};
	frame.addEventListener("pointerdown", stop);
	const began = performance.now();
	const step = (now: number) => {
		const progress = Math.min(1, (now - began) / SETTLE_MS);
		show(cameraBetween(from, to, 1 - (1 - progress) ** 3));
		if (progress < 1) frameId = requestAnimationFrame(step);
		else stop();
	};
	frameId = requestAnimationFrame(step);
	return stop;
}
