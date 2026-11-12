/** A rectangle in canvas pixels, measured from the canvas's top-left corner. */
export interface CanvasRect {
	readonly bottom: number;
	readonly left: number;
	readonly right: number;
	readonly top: number;
}

/** Space a fit leaves free at each canvas edge, as Excalidraw's `canvasOffsets`. */
export interface CanvasOffsets {
	readonly bottom: number;
	readonly left: number;
	readonly right: number;
	readonly top: number;
}

/** How a read-only canvas shows its whole diagram: where it leaves room, and at what zoom. */
export interface ReadOnlyFit {
	readonly canvasOffsets: CanvasOffsets;
	readonly zoom: number;
}

/** Room a fitted diagram keeps from every edge of its canvas. */
const EDGE_PADDING = 16;
/** Room kept between a control and the diagram it would otherwise touch. */
const CONTROL_GAP = 8;
/** Excalidraw's zoom range. */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;

/**
 * Excalidraw's own controls over a read-only canvas: the main menu at the top
 * left and the zoom bar at the bottom left. The mobile layout draws neither.
 */
const CONTROL_SELECTORS = [".main-menu-trigger", ".zoom-actions"];

/** The visible controls Excalidraw draws over the canvas at `canvas`. */
export function measureCanvasControls(
	root: ParentNode,
	canvas: { readonly offsetLeft: number; readonly offsetTop: number },
): CanvasRect[] {
	return CONTROL_SELECTORS.flatMap((selector) =>
		[...root.querySelectorAll(selector)].flatMap((element) => {
			const rect = element.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) return [];
			return [
				{
					bottom: rect.bottom - canvas.offsetTop,
					left: rect.left - canvas.offsetLeft,
					right: rect.right - canvas.offsetLeft,
					top: rect.top - canvas.offsetTop,
				},
			];
		}),
	);
}

interface Placement extends ReadOnlyFit {
	readonly rect: CanvasRect;
}

function place(
	viewport: { readonly height: number; readonly width: number },
	content: { readonly height: number; readonly width: number },
	canvasOffsets: CanvasOffsets,
): Placement {
	const width = viewport.width - canvasOffsets.left - canvasOffsets.right;
	const height = viewport.height - canvasOffsets.top - canvasOffsets.bottom;
	const zoom = Math.min(
		MAX_ZOOM,
		Math.max(MIN_ZOOM, Math.min(width / content.width, height / content.height)),
	);
	const drawnWidth = content.width * zoom;
	const drawnHeight = content.height * zoom;
	const x = canvasOffsets.left + (width - drawnWidth) / 2;
	const y = canvasOffsets.top + (height - drawnHeight) / 2;
	return {
		canvasOffsets,
		zoom,
		rect: { bottom: y + drawnHeight, left: x, right: x + drawnWidth, top: y },
	};
}

const overlaps = (a: CanvasRect, b: CanvasRect) =>
	a.left < b.right + CONTROL_GAP &&
	b.left - CONTROL_GAP < a.right &&
	a.top < b.bottom + CONTROL_GAP &&
	b.top - CONTROL_GAP < a.bottom;

const padded = (offsets: Partial<CanvasOffsets>): CanvasOffsets => ({
	bottom: Math.max(EDGE_PADDING, offsets.bottom ?? 0),
	left: Math.max(EDGE_PADDING, offsets.left ?? 0),
	right: Math.max(EDGE_PADDING, offsets.right ?? 0),
	top: Math.max(EDGE_PADDING, offsets.top ?? 0),
});

/**
 * The exact fit of a `content`-sized diagram in a read-only canvas: as large as
 * it can be inside a small padding, centred, with none of `controls` drawn over
 * it. When the controls would cover it, the diagram keeps clear of the bands
 * above and below them or of the side they sit on, whichever leaves it larger;
 * at the same size the bands win, as they keep the diagram centred across.
 * When no fit can clear them, the plain fit stands. The zoom is exact: Excalidraw's own fit rounds it down to a tenth, which
 * draws a phone diagram up to a fifth smaller than its canvas allows.
 */
export function readOnlyFit(
	viewport: { readonly height: number; readonly width: number },
	content: { readonly height: number; readonly width: number },
	controls: readonly CanvasRect[],
): ReadOnlyFit | undefined {
	if (content.width <= 0 || content.height <= 0) return undefined;
	if (viewport.width <= 0 || viewport.height <= 0) return undefined;
	const clear = (placement: Placement) =>
		controls.every((control) => !overlaps(placement.rect, control));
	const plain = place(viewport, content, padded({}));
	if (clear(plain)) return { canvasOffsets: plain.canvasOffsets, zoom: plain.zoom };

	const middleX = viewport.width / 2;
	const middleY = viewport.height / 2;
	const reach = (values: number[]) => (values.length > 0 ? Math.max(...values) + CONTROL_GAP : 0);
	const sides = {
		left: reach(controls.filter((c) => c.left < middleX).map((c) => c.right)),
		right: reach(controls.filter((c) => c.left >= middleX).map((c) => viewport.width - c.left)),
	};
	const bands = {
		top: reach(controls.filter((c) => c.top < middleY).map((c) => c.bottom)),
		bottom: reach(controls.filter((c) => c.top >= middleY).map((c) => viewport.height - c.top)),
	};
	const [best] = [bands, sides, { ...sides, ...bands }]
		.map((offsets) => place(viewport, content, padded(offsets)))
		.filter(clear)
		.sort((a, b) => b.zoom - a.zoom);
	// A scene too large to clear them even at Excalidraw's smallest zoom keeps the plain fit.
	const chosen = best ?? plain;
	return { canvasOffsets: chosen.canvasOffsets, zoom: chosen.zoom };
}
