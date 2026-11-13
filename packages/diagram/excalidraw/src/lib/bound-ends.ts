import {
	type BindableShape,
	EXCALIDRAW_BINDING_GAP,
	excalidrawBoundPoint,
	excalidrawFixedGlobalPoint,
	excalidrawFixedPoint,
	excalidrawFocusThrough,
	excalidrawKeepsElbowEnd,
	excalidrawOutlineHit,
	type FocusBinding,
	isExcalidrawBindableType,
	type Point,
} from "./excalidraw-binding.js";

/**
 * How far an end turns off an axis-aligned line that misses its shape's middle.
 * Excalidraw's focus lookup needs a strict side to pick its point, and such a
 * line runs exactly along a side of every candidate box; a millionth of a pixel
 * gives it one and draws nothing anyone can see.
 */
const AXIS_TILT = 1e-6;

/** Ends re-placed by Excalidraw within this of where they are drawn count as kept. */
const KEPT = 1e-9;

export interface FocusBoundEnds {
	readonly end?: FocusBinding;
	/**
	 * Whether Excalidraw keeps both ends where they are drawn. A line that runs
	 * along its shape's side, inside the gap, never crosses the outline
	 * Excalidraw places the end on, so no focus keeps it.
	 */
	readonly kept: boolean;
	readonly points: Point[];
	readonly start?: FocusBinding;
}

export interface FixedBoundEnds {
	readonly end?: Point;
	readonly points: Point[];
	readonly start?: Point;
}

const bindable = (shape: BindableShape | undefined) =>
	shape && isExcalidrawBindableType(shape.type) && shape.width > 0 && shape.height > 0
		? shape
		: undefined;

function rotate(point: Point, pivot: Point, angle: number): Point {
	const [dx, dy] = [point[0] - pivot[0], point[1] - pivot[1]];
	return [
		pivot[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
		pivot[1] + dx * Math.sin(angle) + dy * Math.cos(angle),
	];
}

const center = (shape: BindableShape): Point => [
	shape.x + shape.width / 2,
	shape.y + shape.height / 2,
];

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * The route turned off its axis where an end's line would leave Excalidraw no
 * focus: a straight arrow about the middle of the shape it already aims
 * through, or about its far end; a longer one only at that end, about its
 * neighbour.
 */
function tilted(
	points: readonly Point[],
	shapes: readonly [BindableShape | undefined, BindableShape | undefined],
	stuck: readonly [boolean, boolean],
	tilt: number,
): Point[] {
	const next = [...points];
	const last = next.length - 1;
	if (next.length > 2) {
		if (stuck[0]) next[0] = rotate(next[0]!, next[1]!, tilt / distance(next[0]!, next[1]!));
		if (stuck[1])
			next[last] = rotate(
				next[last]!,
				next[last - 1]!,
				tilt / distance(next[last]!, next[last - 1]!),
			);
		return next;
	}
	const [start, end] = [next[0]!, next[1]!];
	const pivot =
		stuck[0] && stuck[1]
			? ([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2] as Point)
			: stuck[0]
				? shapes[1]
					? center(shapes[1])
					: end
				: shapes[0]
					? center(shapes[0])
					: start;
	const reach = Math.max(distance(start, pivot), distance(end, pivot));
	return [rotate(start, pivot, tilt / reach), rotate(end, pivot, tilt / reach)];
}

type Focus = readonly [number | undefined, number | undefined];

/**
 * Whether a square run ends on a box side that runs the same way, hugging the
 * side instead of meeting it.
 */
function runsAlongSide(shape: BindableShape, from: Point, end: Point): boolean {
	if (shape.type === "ellipse" || shape.type === "diamond") return false;
	const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
	if (from[0] === end[0]) return near(end[0], shape.x) || near(end[0], shape.x + shape.width);
	if (from[1] === end[1]) return near(end[1], shape.y) || near(end[1], shape.y + shape.height);
	return false;
}

/**
 * Ends and bindings for an arrow that is not elbowed, so Excalidraw's update
 * maps each end to itself: each end moves along its line onto the outline
 * Excalidraw draws, grown by the gap it binds with, and its focus aims along
 * that line. Each end's neighbour is the next point, the other end on a
 * straight arrow, so both ends settle together. Unbound ends, and ends on
 * shapes Excalidraw cannot bind, keep their points.
 */
export function focusBoundEnds(
	route: readonly Point[],
	startShape: BindableShape | undefined,
	endShape: BindableShape | undefined,
): FocusBoundEnds {
	const shapes = [bindable(startShape), bindable(endShape)] as const;
	if (route.length < 2 || (!shapes[0] && !shapes[1])) return { kept: true, points: [...route] };
	const last = route.length - 1;
	const ends = [
		{ index: 0, neighbour: 1 },
		{ index: last, neighbour: last - 1 },
	] as const;
	const place = (points: readonly Point[], focus: Focus): Point[] => {
		const next = [...points];
		for (const side of [0, 1] as const) {
			const shape = shapes[side];
			const { index, neighbour } = ends[side];
			if (!shape || focus[side] === undefined) continue;
			next[index] =
				excalidrawBoundPoint(
					shape,
					{ focus: focus[side], gap: EXCALIDRAW_BINDING_GAP },
					points[neighbour]!,
					points[index]!,
				) ?? points[index]!;
		}
		return next;
	};
	const focusOf = (points: readonly Point[]): Focus =>
		[0, 1].map((side) => {
			const shape = shapes[side as 0 | 1];
			const { index, neighbour } = ends[side as 0 | 1];
			return shape ? excalidrawFocusThrough(shape, points[neighbour]!, points[index]!) : undefined;
		}) as unknown as Focus;
	const missing = (focus: Focus) =>
		[0, 1].map(
			(side) => shapes[side as 0 | 1] !== undefined && focus[side as 0 | 1] === undefined,
		) as [boolean, boolean];
	// Each pass places both ends from the points before it, as Excalidraw does,
	// aiming at focus points fixed in the shapes, until the ends stop moving: the
	// scene Excalidraw's update maps to itself, Newton steps on a rounded corner
	// included.
	const settle = (points: Point[], fixedFocus?: Focus) => {
		const focus = fixedFocus ?? focusOf(points);
		if (missing(focus).some(Boolean)) return { focus, points };
		for (let pass = 0; pass < 64; pass += 1) {
			const next = place(points, focus);
			const moved = Math.max(...ends.map(({ index }) => distance(next[index]!, points[index]!)));
			points = next;
			if (moved === 0) break;
		}
		return { focus, points };
	};
	const kept = ({ focus, points }: { focus: Focus; points: readonly Point[] }) =>
		!missing(focus).some(Boolean) &&
		ends.every(({ index }) => {
			const placed = place(points, focus)[index]!;
			const point = points[index]!;
			return distance(placed, point) <= KEPT * Math.max(1, Math.abs(point[0]), Math.abs(point[1]));
		});
	const withBindings = (
		{ focus, points }: { focus: Focus; points: Point[] },
		keeps = true,
	): FocusBoundEnds => ({
		kept: keeps,
		points,
		...(shapes[0] ? { start: { focus: focus[0] ?? 0, gap: EXCALIDRAW_BINDING_GAP } } : {}),
		...(shapes[1] ? { end: { focus: focus[1] ?? 0, gap: EXCALIDRAW_BINDING_GAP } } : {}),
	});

	// Such a run stays inside the gap, so Excalidraw places its end on the far corner.
	const hugsSide = ends.some(
		({ index, neighbour }, side) =>
			shapes[side as 0 | 1] !== undefined &&
			runsAlongSide(shapes[side as 0 | 1]!, route[neighbour]!, route[index]!),
	);
	if (hugsSide) return withBindings({ focus: [0, 0], points: [...route] }, false);
	const drawn = settle([...route]);
	if (kept(drawn)) return withBindings(drawn);
	const stuck = missing(focusOf(route));
	for (const tilt of [AXIS_TILT, -AXIS_TILT]) {
		const attempt = settle(tilted(route, shapes, stuck, tilt));
		if (kept(attempt)) return withBindings(attempt);
	}
	// No focus Excalidraw keeps: aim at the middle, where its update takes the end.
	return withBindings(
		settle([...route], [shapes[0] ? 0 : undefined, shapes[1] ? 0 : undefined]),
		false,
	);
}

/**
 * Ends and fixed points for an elbow arrow, so Excalidraw keeps each end when
 * it re-routes the arrow: an end on the outline Excalidraw draws stays, and any
 * other moves along its last run onto that outline. Excalidraw reads a fixed
 * point at a side's middle as 0.5001 of the side, so an end there reads back a
 * ten-thousandth of the side across; the route stays square where it is drawn.
 * Excalidraw draws a diamond's corners a pixel past its box's middle
 * (floor(size / 2) + 1), so a run into a corner ends on the side beside it.
 */
export function fixedBoundEnds(
	route: readonly Point[],
	startShape: BindableShape | undefined,
	endShape: BindableShape | undefined,
): FixedBoundEnds {
	const points = [...route];
	if (points.length < 2) return { points };
	const last = points.length - 1;
	const place = (
		index: number,
		step: 1 | -1,
		shape: BindableShape | undefined,
	): Point | undefined => {
		if (!shape) return undefined;
		const ratio = (point: Point): Point => [
			(point[0] - shape.x) / shape.width,
			(point[1] - shape.y) / shape.height,
		];
		const target = bindable(shape);
		const end = points[index]!;
		if (!target) return ratio(end);
		const neighbour = points[index + step]!;
		// Which coordinate a square run into the end keeps: x for a vertical run.
		const square = end[0] === neighbour[0] ? 0 : end[1] === neighbour[1] ? 1 : undefined;
		const fixed = excalidrawFixedPoint(ratio(end));
		const read = excalidrawFixedGlobalPoint(target, fixed);
		if (excalidrawKeepsElbowEnd(target, read)) return fixed;
		// Find the outline along the run where Excalidraw reads across it, a side's
		// middle at 0.5001; the drawn end moves only along the run, to meet it.
		const across = (point: Point): Point =>
			square === 0 ? [read[0], point[1]] : square === 1 ? [point[0], read[1]] : point;
		const hit = excalidrawOutlineHit(target, across(neighbour), across(end));
		if (!hit) {
			// A run that misses the outline ends where Excalidraw would snap it to:
			// on the outline toward the shape's middle.
			const snapped = excalidrawOutlineHit(target, center(target), end);
			if (!snapped) return fixed;
			points[index] = snapped;
			return excalidrawFixedPoint(ratio(snapped));
		}
		points[index] = square === 0 ? [end[0], hit[1]] : square === 1 ? [hit[0], end[1]] : hit;
		return excalidrawFixedPoint(ratio(hit));
	};
	const start = place(0, 1, startShape);
	const end = place(last, -1, endShape);
	return {
		points,
		...(start ? { start } : {}),
		...(end ? { end } : {}),
	};
}
