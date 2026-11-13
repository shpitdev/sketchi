import {
	type BindableShape,
	excalidrawFixedPoint,
	excalidrawOutlineDistance,
	type Point,
} from "./excalidraw-binding.js";

/**
 * How far inside its shape's outline a bound route must run to pass through
 * it. A bound end sits on the outline or just outside it, and a run that hugs
 * a side stays on it, so neither comes this deep.
 */
const FOLD_DEPTH = 2;

/** Steps along a run through the shape's box, in pixels, at which it is tested. */
const FOLD_STEP = 1;

function bounds(shape: BindableShape) {
	const angle = shape.angle ?? 0;
	const [cx, cy] = [shape.x + shape.width / 2, shape.y + shape.height / 2];
	const reach = [
		Math.abs((shape.width / 2) * Math.cos(angle)) + Math.abs((shape.height / 2) * Math.sin(angle)),
		Math.abs((shape.width / 2) * Math.sin(angle)) + Math.abs((shape.height / 2) * Math.cos(angle)),
	] as const;
	return { maxX: cx + reach[0], maxY: cy + reach[1], minX: cx - reach[0], minY: cy - reach[1] };
}

/** The part of a run inside a box, as fractions along it, or null when it misses. */
function clip(
	from: Point,
	to: Point,
	box: ReturnType<typeof bounds>,
): readonly [number, number] | null {
	let [enter, leave] = [0, 1];
	for (const [start, delta, min, max] of [
		[from[0], to[0] - from[0], box.minX, box.maxX],
		[from[1], to[1] - from[1], box.minY, box.maxY],
	] as const) {
		if (delta === 0) {
			if (start < min || start > max) return null;
			continue;
		}
		const [a, b] = [(min - start) / delta, (max - start) / delta];
		enter = Math.max(enter, Math.min(a, b));
		leave = Math.min(leave, Math.max(a, b));
		if (enter > leave) return null;
	}
	return [enter, leave];
}

/**
 * Whether a route bound to a shape at one end passes through it: some point of
 * it lies deeper inside the outline Excalidraw draws than a bound end or a
 * hugging run ever does. A route whose other end the shape holds, as a line
 * from a node in a zone to the zone's border, belongs inside it and never
 * counts. A route read only to within `slack` pixels must run that much deeper.
 */
export function routeEntersShape(
	route: readonly Point[],
	shape: BindableShape,
	boundEnd: "end" | "start",
	slack = 0,
): boolean {
	if (route.length < 2) return false;
	const inside = (point: Point) => {
		const offset = excalidrawOutlineDistance(shape, point);
		return offset !== null && offset < -(FOLD_DEPTH + slack);
	};
	if (inside(boundEnd === "start" ? route.at(-1)! : route[0]!)) return false;
	const box = bounds(shape);
	for (let index = 1; index < route.length; index += 1) {
		const [from, to] = [route[index - 1]!, route[index]!];
		const part = clip(from, to, box);
		if (!part) continue;
		const length = Math.hypot(to[0] - from[0], to[1] - from[1]) * (part[1] - part[0]);
		const steps = Math.max(1, Math.ceil(length / FOLD_STEP));
		for (let step = 0; step <= steps; step += 1) {
			const t = part[0] + ((part[1] - part[0]) * step) / steps;
			if (inside([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t])) return true;
		}
	}
	return false;
}

/**
 * The fixed point an elbow arrow binds with to keep an end where it meets a
 * shape, as Excalidraw normalizes it.
 */
export function elbowFixedPointAt(shape: BindableShape, point: Point): Point {
	// Excalidraw reads a fixed point in the shape's own, unrotated frame.
	const angle = -(shape.angle ?? 0);
	const [cx, cy] = [shape.x + shape.width / 2, shape.y + shape.height / 2];
	const [dx, dy] = [point[0] - cx, point[1] - cy];
	const [x, y] = [
		cx + dx * Math.cos(angle) - dy * Math.sin(angle),
		cy + dx * Math.sin(angle) + dy * Math.cos(angle),
	];
	return excalidrawFixedPoint([(x - shape.x) / shape.width, (y - shape.y) / shape.height]);
}
