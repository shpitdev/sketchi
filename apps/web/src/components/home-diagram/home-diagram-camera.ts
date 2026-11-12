import { HOME_DIAGRAM } from "./home-diagram-data.js";

/** Excalidraw's view of the scene: scene point (x, y) draws at ((x + scrollX) * zoom, (y + scrollY) * zoom). */
export interface Camera {
	scrollX: number;
	scrollY: number;
	zoom: number;
}

/** Space Excalidraw's own toolbars cover along each edge of the canvas, in pixels. */
export interface Insets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** Room left between the drawing and a toolbar or the canvas edge. */
const GAP = 12;

/** The drawing's bounds in scene units: the export without its padding. */
const drawing = {
	x: HOME_DIAGRAM.origin.x + HOME_DIAGRAM.padding,
	y: HOME_DIAGRAM.origin.y + HOME_DIAGRAM.padding,
	width: HOME_DIAGRAM.width - 2 * HOME_DIAGRAM.padding,
	height: HOME_DIAGRAM.height - 2 * HOME_DIAGRAM.padding,
};

/** The camera that draws the scene exactly where the image of it sat, `width` pixels wide. */
export function imageCamera(width: number): Camera {
	return {
		scrollX: -HOME_DIAGRAM.origin.x,
		scrollY: -HOME_DIAGRAM.origin.y,
		zoom: width / HOME_DIAGRAM.width,
	};
}

/**
 * The camera that shows the whole drawing, centred in the part of a
 * `width` by `height` canvas the toolbars leave free. It never zooms in past
 * the image, so opening the editor only ever settles the drawing a little.
 */
export function cameraBetweenToolbars(width: number, height: number, insets: Insets): Camera {
	const left = insets.left + GAP;
	const top = insets.top + GAP;
	const free = {
		width: Math.max(1, width - left - insets.right - GAP),
		height: Math.max(1, height - top - insets.bottom - GAP),
	};
	const zoom = Math.min(
		free.width / drawing.width,
		free.height / drawing.height,
		imageCamera(width).zoom,
	);
	return {
		scrollX: (left + free.width / 2) / zoom - (drawing.x + drawing.width / 2),
		scrollY: (top + free.height / 2) / zoom - (drawing.y + drawing.height / 2),
		zoom,
	};
}

/**
 * A camera part way from `from` to `to`, `progress` from 0 to 1. The drawing's
 * centre moves in a straight line on screen while the zoom changes.
 */
export function cameraBetween(from: Camera, to: Camera, progress: number): Camera {
	const centre = { x: drawing.x + drawing.width / 2, y: drawing.y + drawing.height / 2 };
	const onScreen = (camera: Camera) => ({
		x: (centre.x + camera.scrollX) * camera.zoom,
		y: (centre.y + camera.scrollY) * camera.zoom,
	});
	const start = onScreen(from);
	const end = onScreen(to);
	const zoom = from.zoom + (to.zoom - from.zoom) * progress;
	return {
		scrollX: (start.x + (end.x - start.x) * progress) / zoom - centre.x,
		scrollY: (start.y + (end.y - start.y) * progress) / zoom - centre.y,
		zoom,
	};
}

/**
 * What Excalidraw's toolbars cover inside `frame`. In the compact layout a box
 * this size gets, tools run along the top, the menu and undo along the bottom,
 * and a short column of tools down the right edge.
 */
export function toolbarInsets(frame: HTMLElement): Insets {
	const box = frame.getBoundingClientRect();
	const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
	for (const element of frame.querySelectorAll(".App-toolbar, .mobile-misc-tools-container")) {
		const rect = element.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) continue;
		if (rect.height > rect.width) {
			insets.right = Math.max(insets.right, box.right - rect.left);
		} else if ((rect.top + rect.bottom) / 2 < box.top + box.height / 2) {
			insets.top = Math.max(insets.top, rect.bottom - box.top);
		} else {
			insets.bottom = Math.max(insets.bottom, box.bottom - rect.top);
		}
	}
	return insets;
}
