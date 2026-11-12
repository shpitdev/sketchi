/** A rectangle in canvas pixels, measured from the canvas's top-left corner. */
export interface CanvasRect {
	readonly bottom: number;
	readonly left: number;
	readonly right: number;
	readonly top: number;
}

/** Space a fit leaves free at each canvas edge, as Excalidraw's `canvasOffsets`. */
export interface CanvasOffsets {
	readonly bottom?: number;
	readonly left?: number;
	readonly right?: number;
	readonly top?: number;
}

/** Room kept between a control and the diagram it would otherwise touch. */
const CONTROL_GAP = 8;

/** Excalidraw rounds a fit's zoom down to a tenth, and never below one. */
const fittedZoom = (zoom: number) => Math.max(0.1, Math.floor(zoom * 10 + 1e-9) / 10);

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

interface Placement {
	readonly offsets: CanvasOffsets | undefined;
	readonly zoom: number;
	readonly rect: CanvasRect;
}

function place(
	viewport: { readonly height: number; readonly width: number },
	content: { readonly height: number; readonly width: number },
	offsets: CanvasOffsets | undefined,
): Placement {
	const left = offsets?.left ?? 0;
	const top = offsets?.top ?? 0;
	const width = viewport.width - left - (offsets?.right ?? 0);
	const height = viewport.height - top - (offsets?.bottom ?? 0);
	const zoom = fittedZoom(Math.min(width / content.width, height / content.height));
	const drawnWidth = content.width * zoom;
	const drawnHeight = content.height * zoom;
	const x = left + (width - drawnWidth) / 2;
	const y = top + (height - drawnHeight) / 2;
	return {
		offsets,
		zoom,
		rect: { bottom: y + drawnHeight, left: x, right: x + drawnWidth, top: y },
	};
}

const overlaps = (a: CanvasRect, b: CanvasRect) =>
	a.left < b.right + CONTROL_GAP &&
	b.left - CONTROL_GAP < a.right &&
	a.top < b.bottom + CONTROL_GAP &&
	b.top - CONTROL_GAP < a.bottom;

/**
 * The canvas offsets that fit a diagram as large as it can be without any of
 * `controls` drawn over it, or `undefined` when the plain fit already clears
 * them. The diagram either keeps clear of the bands above and below the
 * controls or of the side they sit on, whichever leaves it larger; at the
 * same size the bands win, as they keep the diagram centred across.
 */
export function fitClearOfControls(
	viewport: { readonly height: number; readonly width: number },
	content: { readonly height: number; readonly width: number },
	controls: readonly CanvasRect[],
): CanvasOffsets | undefined {
	if (controls.length === 0 || content.width <= 0 || content.height <= 0) return undefined;
	const clear = (placement: Placement) =>
		controls.every((control) => !overlaps(placement.rect, control));
	if (clear(place(viewport, content, undefined))) return undefined;

	const middleX = viewport.width / 2;
	const middleY = viewport.height / 2;
	const reach = (values: number[]) => (values.length > 0 ? Math.max(...values) + CONTROL_GAP : 0);
	const sides: CanvasOffsets = {
		left: reach(controls.filter((c) => c.left < middleX).map((c) => c.right)),
		right: reach(controls.filter((c) => c.left >= middleX).map((c) => viewport.width - c.left)),
	};
	const bands: CanvasOffsets = {
		top: reach(controls.filter((c) => c.top < middleY).map((c) => c.bottom)),
		bottom: reach(controls.filter((c) => c.top >= middleY).map((c) => viewport.height - c.top)),
	};
	const candidates = [bands, sides, { ...sides, ...bands }]
		.map((offsets) => place(viewport, content, offsets))
		.filter(clear)
		.sort((a, b) => b.zoom - a.zoom);
	return candidates[0]?.offsets ?? { ...sides, ...bands };
}
