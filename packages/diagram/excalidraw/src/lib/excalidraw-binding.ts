/**
 * Excalidraw 0.18.1's geometry for the ends of a bound arrow, ported line for
 * line so every end this package exports is the end Excalidraw itself computes
 * for it. When a person drags a shape, Excalidraw re-places each bound end from
 * its binding alone: an arrow that is not elbowed aims from its neighbouring
 * point at the binding's focus point and stops at the binding's gap outside the
 * outline Excalidraw draws; an elbow arrow ends at the binding's fixed point on
 * that outline. Writing ends and bindings that Excalidraw's update maps to
 * themselves keeps every arrow where it was drawn on the first touch and on
 * the outline after every drag.
 *
 * Every element here is unrotated, as this package writes them; the rotations
 * by zero are kept so the arithmetic matches Excalidraw's to the last bit.
 */

export type Point = readonly [number, number];
type Segment = readonly [Point, Point];
type Curve = readonly [Point, Point, Point, Point];

/** The fields of an Excalidraw element its binding geometry reads. */
export interface BindableShape {
	readonly angle?: number;
	readonly height: number;
	readonly roundness?: { readonly type: number; readonly value?: number } | null;
	readonly type: string;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}

/** A binding of an arrow that is not elbowed. */
export interface FocusBinding {
	readonly focus: number;
	readonly gap: number;
}

/**
 * The gap Excalidraw binds an end on the outline with: calculateFocusAndGap
 * never writes less than 1, and a gap of 0 makes its update drop the end on
 * the focus point, inside the shape.
 */
export const EXCALIDRAW_BINDING_GAP = 1;

/** How far outside its outline Excalidraw keeps an elbow arrow end it re-places. */
const FIXED_BINDING_DISTANCE = 5;
const PRECISION = 1e-4;
const DEFAULT_PROPORTIONAL_RADIUS = 0.25;
const DEFAULT_ADAPTIVE_RADIUS = 32;
const ROUNDNESS_LEGACY = 1;
const ROUNDNESS_PROPORTIONAL = 2;
const ROUNDNESS_ADAPTIVE = 3;

const RECTANGULOIDS = new Set([
	"rectangle",
	"image",
	"text",
	"iframe",
	"embeddable",
	"frame",
	"magicframe",
]);

/** Element types Excalidraw binds arrows to and re-places their ends against. */
export function isExcalidrawBindableType(type: string): boolean {
	return RECTANGULOIDS.has(type) || type === "diamond" || type === "ellipse";
}

// ../math: points and vectors

const pointFrom = (x: number, y: number): Point => [x, y];

function pointRotateRads([x, y]: Point, [cx, cy]: Point, angle: number): Point {
	return pointFrom(
		(x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle) + cx,
		(x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle) + cy,
	);
}

function pointsEqual(a: Point, b: Point): boolean {
	return Math.abs(a[0] - b[0]) < PRECISION && Math.abs(a[1] - b[1]) < PRECISION;
}

const pointDistance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function pointDistanceSq(a: Point, b: Point): number {
	const xDiff = b[0] - a[0];
	const yDiff = b[1] - a[1];
	return xDiff * xDiff + yDiff * yDiff;
}

const vectorFromPoint = (p: Point, origin: Point = [0, 0]): Point => [
	p[0] - origin[0],
	p[1] - origin[1],
];
const vectorCross = (a: Point, b: Point) => a[0] * b[1] - b[0] * a[1];
const vectorScale = (v: Point, scalar: number): Point => [v[0] * scalar, v[1] * scalar];
const pointFromVector = (v: Point, offset: Point = [0, 0]): Point => [
	offset[0] + v[0],
	offset[1] + v[1],
];

function vectorNormalize(v: Point): Point {
	const m = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
	return m === 0 ? [0, 0] : [v[0] / m, v[1] / m];
}

const round = (value: number, precision: number) => {
	const multiplier = Math.pow(10, precision);
	return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
};

// ../math: segments, curves, ellipses

function linesIntersectAt(a: Segment, b: Segment): Point | null {
	const A1 = a[1][1] - a[0][1];
	const B1 = a[0][0] - a[1][0];
	const A2 = b[1][1] - b[0][1];
	const B2 = b[0][0] - b[1][0];
	const D = A1 * B2 - A2 * B1;
	if (D !== 0) {
		const C1 = A1 * a[0][0] + B1 * a[0][1];
		const C2 = A2 * b[0][0] + B2 * b[0][1];
		return pointFrom((C1 * B2 - C2 * B1) / D, (A1 * C2 - A2 * C1) / D);
	}
	return null;
}

function distanceToLineSegment(point: Point, line: Segment): number {
	const [x, y] = point;
	const [[x1, y1], [x2, y2]] = line;
	const A = x - x1;
	const B = y - y1;
	const C = x2 - x1;
	const D = y2 - y1;
	const dot = A * C + B * D;
	const lenSq = C * C + D * D;
	let param = -1;
	if (lenSq !== 0) param = dot / lenSq;
	let xx: number;
	let yy: number;
	if (param < 0) {
		xx = x1;
		yy = y1;
	} else if (param > 1) {
		xx = x2;
		yy = y2;
	} else {
		xx = x1 + param * C;
		yy = y1 + param * D;
	}
	const dx = x - xx;
	const dy = y - yy;
	return Math.sqrt(dx * dx + dy * dy);
}

function pointOnLineSegment(point: Point, line: Segment): boolean {
	const distance = distanceToLineSegment(point, line);
	return distance === 0 || distance < PRECISION;
}

function lineSegmentIntersectionPoints(l: Segment, s: Segment): Point | null {
	const candidate = linesIntersectAt(l, s);
	if (!candidate || !pointOnLineSegment(candidate, s) || !pointOnLineSegment(candidate, l)) {
		return null;
	}
	return candidate;
}

function rectangleIntersectLineSegment(r: Segment, l: Segment): Point[] {
	return [
		[r[0], pointFrom(r[1][0], r[0][1])] as const,
		[pointFrom(r[1][0], r[0][1]), r[1]] as const,
		[r[1], pointFrom(r[0][0], r[1][1])] as const,
		[pointFrom(r[0][0], r[1][1]), r[0]] as const,
	]
		.map((s) => lineSegmentIntersectionPoints(l, s))
		.filter((i): i is Point => !!i);
}

function gradient(
	f: (t: number, s: number) => number,
	t0: number,
	s0: number,
	delta = 1e-6,
): Point {
	return [
		(f(t0 + delta, s0) - f(t0 - delta, s0)) / (2 * delta),
		(f(t0, s0 + delta) - f(t0, s0 - delta)) / (2 * delta),
	];
}

/** Excalidraw's Newton solve for where a curve meets a line. */
function solve(
	f: (t: number, s: number) => Point,
	t0: number,
	s0: number,
	tolerance = 1e-3,
	iterLimit = 10,
): Point | null {
	let error = Infinity;
	let iter = 0;
	while (error >= tolerance) {
		if (iter >= iterLimit) return null;
		const y0 = f(t0, s0);
		const jacobian = [
			gradient((t, s) => f(t, s)[0], t0, s0),
			gradient((t, s) => f(t, s)[1], t0, s0),
		] as const;
		const b = [[-y0[0]], [-y0[1]]] as const;
		const det = jacobian[0][0] * jacobian[1][1] - jacobian[0][1] * jacobian[1][0];
		if (det === 0) return null;
		const iJ = [
			[jacobian[1][1] / det, -jacobian[0][1] / det],
			[-jacobian[1][0] / det, jacobian[0][0] / det],
		] as const;
		const h = [
			[iJ[0][0] * b[0][0] + iJ[0][1] * b[1][0]],
			[iJ[1][0] * b[0][0] + iJ[1][1] * b[1][0]],
		] as const;
		t0 = t0 + h[0][0];
		s0 = s0 + h[1][0];
		const [tErr, sErr] = f(t0, s0);
		error = Math.max(Math.abs(tErr), Math.abs(sErr));
		iter += 1;
	}
	return [t0, s0];
}

const bezierEquation = (c: Curve, t: number): Point =>
	pointFrom(
		(1 - t) ** 3 * c[0][0] +
			3 * (1 - t) ** 2 * t * c[1][0] +
			3 * (1 - t) * t ** 2 * c[2][0] +
			t ** 3 * c[3][0],
		(1 - t) ** 3 * c[0][1] +
			3 * (1 - t) ** 2 * t * c[1][1] +
			3 * (1 - t) * t ** 2 * c[2][1] +
			t ** 3 * c[3][1],
	);

function curveIntersectLineSegment(c: Curve, l: Segment): Point[] {
	const xs = c.map((p) => p[0]);
	const ys = c.map((p) => p[1]);
	const bounds: Segment = [
		pointFrom(Math.min(...xs), Math.min(...ys)),
		pointFrom(Math.max(...xs), Math.max(...ys)),
	];
	if (rectangleIntersectLineSegment(bounds, l).length === 0) return [];
	const line = (s: number) =>
		pointFrom(l[0][0] + s * (l[1][0] - l[0][0]), l[0][1] + s * (l[1][1] - l[0][1]));
	const calculate = ([t0, s0]: Point): Point | null => {
		const solution = solve(
			(t2, s2) => {
				const bezierPoint = bezierEquation(c, t2);
				const linePoint = line(s2);
				return [bezierPoint[0] - linePoint[0], bezierPoint[1] - linePoint[1]];
			},
			t0,
			s0,
		);
		if (!solution) return null;
		const [t, s] = solution;
		if (t < 0 || t > 1 || s < 0 || s > 1) return null;
		return bezierEquation(c, t);
	};
	for (const guess of [
		[0.5, 0],
		[0.2, 0],
		[0.8, 0],
	] as const) {
		const solution = calculate(guess);
		if (solution) return [solution];
	}
	return [];
}

function ellipseLineIntersectionPoints(
	center: Point,
	halfWidth: number,
	halfHeight: number,
	[g, h]: Segment,
): Point[] {
	const [cx, cy] = center;
	const x1 = g[0] - cx;
	const y1 = g[1] - cy;
	const x2 = h[0] - cx;
	const y2 = h[1] - cy;
	const a =
		Math.pow(x2 - x1, 2) / Math.pow(halfWidth, 2) + Math.pow(y2 - y1, 2) / Math.pow(halfHeight, 2);
	const b =
		2 * ((x1 * (x2 - x1)) / Math.pow(halfWidth, 2) + (y1 * (y2 - y1)) / Math.pow(halfHeight, 2));
	const c =
		Math.pow(x1, 2) / Math.pow(halfWidth, 2) + Math.pow(y1, 2) / Math.pow(halfHeight, 2) - 1;
	const t1 = (-b + Math.sqrt(Math.pow(b, 2) - 4 * a * c)) / (2 * a);
	const t2 = (-b - Math.sqrt(Math.pow(b, 2) - 4 * a * c)) / (2 * a);
	const candidates = [
		pointFrom(x1 + t1 * (x2 - x1) + cx, y1 + t1 * (y2 - y1) + cy),
		pointFrom(x1 + t2 * (x2 - x1) + cx, y1 + t2 * (y2 - y1) + cy),
	].filter((p) => !isNaN(p[0]) && !isNaN(p[1]));
	if (candidates.length === 2 && pointsEqual(candidates[0]!, candidates[1]!)) {
		return [candidates[0]!];
	}
	return candidates;
}

// element: outlines

function cornerRadius(x: number, shape: BindableShape): number {
	const type = shape.roundness?.type;
	if (type === ROUNDNESS_PROPORTIONAL || type === ROUNDNESS_LEGACY) {
		return x * DEFAULT_PROPORTIONAL_RADIUS;
	}
	if (type === ROUNDNESS_ADAPTIVE) {
		const fixedRadiusSize = shape.roundness?.value ?? DEFAULT_ADAPTIVE_RADIUS;
		const cutoffSize = fixedRadiusSize / DEFAULT_PROPORTIONAL_RADIUS;
		return x <= cutoffSize ? x * DEFAULT_PROPORTIONAL_RADIUS : fixedRadiusSize;
	}
	return 0;
}

/** Excalidraw's diamond vertices, relative to its box: top, right, bottom, left. */
function diamondPoints(shape: BindableShape) {
	const topX = Math.floor(shape.width / 2) + 1;
	const rightY = Math.floor(shape.height / 2) + 1;
	return { topX, topY: 0, rightX: shape.width, rightY, bottomX: topX, bottomY: shape.height };
}

function rectanguloidParts(shape: BindableShape, offset: number): [Segment[], Curve[]] {
	const roundness = cornerRadius(Math.min(shape.width, shape.height), shape);
	if (roundness <= 0) {
		const r0 = pointFrom(shape.x - offset, shape.y - offset);
		const r1 = pointFrom(shape.x + shape.width + offset, shape.y + shape.height + offset);
		return [
			[
				[pointFrom(r0[0] + roundness, r0[1]), pointFrom(r1[0] - roundness, r0[1])],
				[pointFrom(r1[0], r0[1] + roundness), pointFrom(r1[0], r1[1] - roundness)],
				[pointFrom(r0[0] + roundness, r1[1]), pointFrom(r1[0] - roundness, r1[1])],
				[pointFrom(r0[0], r1[1] - roundness), pointFrom(r0[0], r0[1] + roundness)],
			],
			[],
		];
	}
	const center = pointFrom(shape.x + shape.width / 2, shape.y + shape.height / 2);
	const r0 = pointFrom(shape.x, shape.y);
	const r1 = pointFrom(shape.x + shape.width, shape.y + shape.height);
	const top: Segment = [pointFrom(r0[0] + roundness, r0[1]), pointFrom(r1[0] - roundness, r0[1])];
	const right: Segment = [pointFrom(r1[0], r0[1] + roundness), pointFrom(r1[0], r1[1] - roundness)];
	const bottom: Segment = [
		pointFrom(r0[0] + roundness, r1[1]),
		pointFrom(r1[0] - roundness, r1[1]),
	];
	const left: Segment = [pointFrom(r0[0], r1[1] - roundness), pointFrom(r0[0], r0[1] + roundness)];
	const offsets = [
		pointFrom(r0[0] - offset, r0[1] - offset),
		pointFrom(r1[0] + offset, r0[1] - offset),
		pointFrom(r1[0] + offset, r1[1] + offset),
		pointFrom(r0[0] - offset, r1[1] + offset),
	].map((corner) => vectorScale(vectorNormalize(vectorFromPoint(corner, center)), offset)) as [
		Point,
		Point,
		Point,
		Point,
	];
	const toward = (from: Point, cornerX: number, cornerY: number) =>
		pointFrom(from[0] + (2 / 3) * (cornerX - from[0]), from[1] + (2 / 3) * (cornerY - from[1]));
	const corners: [Curve, Curve, Curve, Curve] = [
		[
			pointFromVector(offsets[0], left[1]),
			pointFromVector(offsets[0], toward(left[1], r0[0], r0[1])),
			pointFromVector(offsets[0], toward(top[0], r0[0], r0[1])),
			pointFromVector(offsets[0], top[0]),
		],
		[
			pointFromVector(offsets[1], top[1]),
			pointFromVector(offsets[1], toward(top[1], r1[0], r0[1])),
			pointFromVector(offsets[1], toward(right[0], r1[0], r0[1])),
			pointFromVector(offsets[1], right[0]),
		],
		[
			pointFromVector(offsets[2], right[1]),
			pointFromVector(offsets[2], toward(right[1], r1[0], r1[1])),
			pointFromVector(offsets[2], toward(bottom[1], r1[0], r1[1])),
			pointFromVector(offsets[2], bottom[1]),
		],
		[
			pointFromVector(offsets[3], bottom[0]),
			pointFromVector(offsets[3], toward(bottom[0], r0[0], r1[1])),
			pointFromVector(offsets[3], toward(left[0], r0[0], r1[1])),
			pointFromVector(offsets[3], left[0]),
		],
	];
	return [
		[
			[corners[0][3], corners[1][0]],
			[corners[1][3], corners[2][0]],
			[corners[2][3], corners[3][0]],
			[corners[3][3], corners[0][0]],
		],
		corners,
	];
}

/** A diamond's sides; this package draws diamonds with sharp corners only. */
function diamondSides(shape: BindableShape, offset: number): Segment[] | null {
	if (shape.roundness?.type !== undefined && shape.roundness !== null) return null;
	const { topX, topY, rightX, rightY, bottomX, bottomY } = diamondPoints(shape);
	const top = pointFrom(shape.x + topX, shape.y + topY - offset);
	const right = pointFrom(shape.x + rightX + offset, shape.y + rightY);
	const bottom = pointFrom(shape.x + bottomX, shape.y + bottomY + offset);
	const left = pointFrom(shape.x - offset, shape.y + rightY);
	return [
		[top, right],
		[right, bottom],
		[bottom, left],
		[left, top],
	];
}

const shapeCenter = (shape: BindableShape) =>
	pointFrom(shape.x + shape.width / 2, shape.y + shape.height / 2);

/**
 * Excalidraw's intersectElementWithLineSegment: where a segment meets the
 * shape's outline, grown by `offset`. Null for a shape it has no outline for.
 */
function intersectShape(shape: BindableShape, line: Segment, offset: number): Point[] | null {
	const center = shapeCenter(shape);
	const angle = shape.angle ?? 0;
	const rotatedA = pointRotateRads(line[0], center, -angle);
	const rotatedB = pointRotateRads(line[1], center, -angle);
	const rotated: Segment = [rotatedA, rotatedB];
	const back = (p: Point) => pointRotateRads(p, center, angle);
	let found: Point[];
	if (RECTANGULOIDS.has(shape.type)) {
		const [sides, corners] = rectanguloidParts(shape, offset);
		found = [
			...sides
				.map((s) => lineSegmentIntersectionPoints(rotated, s))
				.filter((p): p is Point => p !== null)
				.map(back),
			...corners.flatMap((c) => curveIntersectLineSegment(c, rotated)).map(back),
		];
	} else if (shape.type === "diamond") {
		const sides = diamondSides(shape, offset);
		if (!sides) return null;
		found = sides
			.map((s) => lineSegmentIntersectionPoints(rotated, s))
			.filter((p): p is Point => p !== null)
			.map(back);
	} else if (shape.type === "ellipse") {
		return ellipseLineIntersectionPoints(
			center,
			shape.width / 2 + offset,
			shape.height / 2 + offset,
			rotated,
		).map(back);
	} else {
		return null;
	}
	return found.filter((p, index, points) => points.findIndex((d) => pointsEqual(p, d)) === index);
}

/** Excalidraw's determineFocusPoint: the point inside the shape a focus aims at. */
export function excalidrawFocusPoint(
	shape: BindableShape,
	focus: number,
	adjacentPoint: Point,
): Point {
	const center = shapeCenter(shape);
	if (focus === 0) return center;
	const { x, y, width, height } = shape;
	const angle = shape.angle ?? 0;
	const corners =
		shape.type === "diamond"
			? [
					pointFrom(x, y + height / 2),
					pointFrom(x + width / 2, y),
					pointFrom(x + width, y + height / 2),
					pointFrom(x + width / 2, y + height),
				]
			: [
					pointFrom(x, y),
					pointFrom(x + width, y),
					pointFrom(x + width, y + height),
					pointFrom(x, y + height),
				];
	const [c0, c1, c2, c3] = corners
		.map((p) => pointFromVector(vectorScale(vectorFromPoint(p, center), Math.abs(focus)), center))
		.map((p) => pointRotateRads(p, center, angle)) as [Point, Point, Point, Point];
	const outside = (from: Point, to: Point) =>
		vectorCross(vectorFromPoint(adjacentPoint, from), vectorFromPoint(to, from));
	const selected = [
		outside(c0, c1) > 0 && (focus > 0 ? outside(c1, c2) < 0 : outside(c3, c0) < 0),
		outside(c1, c2) > 0 && (focus > 0 ? outside(c2, c3) < 0 : outside(c0, c1) < 0),
		outside(c2, c3) > 0 && (focus > 0 ? outside(c3, c0) < 0 : outside(c1, c2) < 0),
	];
	return selected[0]
		? focus > 0
			? c1
			: c0
		: selected[1]
			? focus > 0
				? c2
				: c1
			: selected[2]
				? focus > 0
					? c3
					: c2
				: focus > 0
					? c0
					: c3;
}

/**
 * Excalidraw's updateBoundPoint for an arrow that is not elbowed: where it
 * re-places an end bound to `shape`, aiming from `adjacentPoint`, the end's
 * neighbour on the arrow. Null for a shape it has no outline for.
 */
export function excalidrawBoundPoint(
	shape: BindableShape,
	binding: FocusBinding,
	adjacentPoint: Point,
	edgePoint: Point,
): Point | null {
	const focusPoint = excalidrawFocusPoint(shape, binding.focus, adjacentPoint);
	if (binding.gap === 0) return focusPoint;
	const center = shapeCenter(shape);
	const interceptorLength =
		pointDistance(adjacentPoint, edgePoint) +
		pointDistance(adjacentPoint, center) +
		Math.max(shape.width, shape.height) * 2;
	const intersections = intersectShape(
		shape,
		[
			adjacentPoint,
			pointFromVector(
				vectorScale(vectorNormalize(vectorFromPoint(focusPoint, adjacentPoint)), interceptorLength),
				adjacentPoint,
			),
		],
		binding.gap,
	);
	if (!intersections) return null;
	intersections.sort(
		(g, h) => pointDistanceSq(g, adjacentPoint) - pointDistanceSq(h, adjacentPoint),
	);
	if (intersections.length > 1) return intersections[0]!;
	if (intersections.length === 1) return focusPoint;
	return edgePoint;
}

/**
 * The focus whose point lies on the line from `adjacentPoint` through `point`,
 * so Excalidraw keeps aiming the end where it was drawn, the least such focus
 * when the line meets both diagonals. Undefined when Excalidraw's lookup cannot
 * land on that line, which happens when the line runs parallel to a side of the
 * shape its candidates span (an axis-aligned line off a box's middle).
 */
export function excalidrawFocusThrough(
	shape: BindableShape,
	adjacentPoint: Point,
	point: Point,
): number | undefined {
	const center = shapeCenter(shape);
	const direction = vectorFromPoint(point, adjacentPoint);
	const length = Math.hypot(direction[0], direction[1]);
	if (length === 0) return undefined;
	const along = vectorCross(vectorFromPoint(adjacentPoint, center), direction);
	const size = Math.max(shape.width, shape.height);
	if (Math.abs(along) <= 1e-12 * length * size) return 0;
	const { x, y, width, height } = shape;
	const corners =
		shape.type === "diamond"
			? [
					pointFrom(x, y + height / 2),
					pointFrom(x + width / 2, y),
					pointFrom(x + width, y + height / 2),
					pointFrom(x + width / 2, y + height),
				]
			: [
					pointFrom(x, y),
					pointFrom(x + width, y),
					pointFrom(x + width, y + height),
					pointFrom(x, y + height),
				];
	let best: number | undefined;
	for (const corner of corners) {
		const toCorner = vectorFromPoint(corner, center);
		const denominator = vectorCross(toCorner, direction);
		if (denominator === 0) continue;
		const scale = along / denominator;
		if (!(scale > 0)) continue;
		const target = pointFromVector(vectorScale(toCorner, scale), center);
		for (const focus of [scale, -scale]) {
			const aimed = excalidrawFocusPoint(shape, focus, adjacentPoint);
			if (pointDistance(aimed, target) > 1e-9 * size) continue;
			if (best === undefined || Math.abs(focus) < Math.abs(best)) best = focus;
		}
	}
	return best;
}

/** Excalidraw's normalizeFixedPoint: a ratio at the middle reads as 0.5001. */
export function excalidrawFixedPoint(ratio: Point): Point {
	return Math.abs(ratio[0] - 0.5) < PRECISION || Math.abs(ratio[1] - 0.5) < PRECISION
		? (ratio.map((value) => (Math.abs(value - 0.5) < PRECISION ? 0.5001 : value)) as [
				number,
				number,
			])
		: ratio;
}

/** Excalidraw's getGlobalFixedPointForBindableElement. */
export function excalidrawFixedGlobalPoint(shape: BindableShape, fixedPoint: Point): Point {
	const [fixedX, fixedY] = excalidrawFixedPoint(fixedPoint);
	return pointRotateRads(
		pointFrom(shape.x + shape.width * fixedX, shape.y + shape.height * fixedY),
		shapeCenter(shape),
		shape.angle ?? 0,
	);
}

/**
 * Where a segment from `from` toward `to`, carried on past it, first meets the
 * outline Excalidraw draws for the shape. Null when it misses or the shape has
 * no outline.
 */
export function excalidrawOutlineHit(
	shape: BindableShape,
	from: Point,
	to: Point,
	offset = 0,
): Point | null {
	const reach =
		pointDistance(from, to) +
		pointDistance(from, shapeCenter(shape)) +
		2 * Math.max(shape.width, shape.height);
	const hits = intersectShape(
		shape,
		[from, pointFromVector(vectorScale(vectorNormalize(vectorFromPoint(to, from)), reach), from)],
		offset,
	);
	if (!hits || hits.length === 0) return null;
	return hits.sort((g, h) => pointDistanceSq(g, from) - pointDistanceSq(h, from))[0]!;
}

/** Excalidraw's outline for a shape as a closed polyline, its curves finely stepped. */
function outlinePolyline(shape: BindableShape): Point[] | null {
	const center = shapeCenter(shape);
	const angle = shape.angle ?? 0;
	const back = (p: Point) => pointRotateRads(p, center, angle);
	if (shape.type === "ellipse") {
		const steps = 720;
		return Array.from({ length: steps + 1 }, (_, step) => {
			const turn = (step / steps) * 2 * Math.PI;
			return back([
				center[0] + (shape.width / 2) * Math.cos(turn),
				center[1] + (shape.height / 2) * Math.sin(turn),
			]);
		});
	}
	if (shape.type === "diamond") {
		const sides = diamondSides(shape, 0);
		return sides ? [...sides.map(([from]) => back(from)), back(sides[0]![0])] : null;
	}
	if (!RECTANGULOIDS.has(shape.type)) return null;
	const [, corners] = rectanguloidParts(shape, 0);
	if (corners.length === 0) {
		const { x, y, width, height } = shape;
		return [
			pointFrom(x, y),
			pointFrom(x + width, y),
			pointFrom(x + width, y + height),
			pointFrom(x, y + height),
			pointFrom(x, y),
		].map(back);
	}
	const points = corners.flatMap((corner) =>
		Array.from({ length: 65 }, (_, step) => back(bezierEquation(corner, step / 64))),
	);
	return [...points, points[0]!];
}

/**
 * How far a point lies outside the outline Excalidraw draws for a shape,
 * negative inside it. Null for a shape it has no outline for.
 */
export function excalidrawOutlineDistance(shape: BindableShape, point: Point): number | null {
	const outline = outlinePolyline(shape);
	if (!outline) return null;
	let nearest = Infinity;
	let inside = false;
	// A ray a hair off the point's height never runs through a vertex.
	const rayY = point[1] + 1e-7;
	for (let index = 1; index < outline.length; index += 1) {
		const from = outline[index - 1]!;
		const to = outline[index]!;
		nearest = Math.min(nearest, distanceToLineSegment(point, [from, to]));
		if (
			from[1] > rayY !== to[1] > rayY &&
			point[0] < from[0] + ((rayY - from[1]) * (to[0] - from[0])) / (to[1] - from[1])
		)
			inside = !inside;
	}
	return inside ? -nearest : nearest;
}

/** How far out Excalidraw re-places an elbow arrow end that is not on the outline. */
export const EXCALIDRAW_ELBOW_DISTANCE = FIXED_BINDING_DISTANCE;

/**
 * Whether Excalidraw keeps an elbow arrow end that sits on the shape's outline
 * when it re-routes the arrow. getGlobalPoint hands any fixed point that is not
 * FIXED_BINDING_DISTANCE out to bindPointToSnapToElementOutline, which keeps a
 * point within a hundredth of the outline, along the ray from the middle, and
 * moves any other.
 */
export function excalidrawKeepsElbowEnd(shape: BindableShape, point: Point): boolean {
	const center = shapeCenter(shape);
	const hit = intersectShape(
		shape,
		[
			center,
			pointFromVector(
				vectorScale(
					vectorNormalize(vectorFromPoint(point, center)),
					Math.max(shape.width, shape.height),
				),
				center,
			),
		],
		0,
	)?.[0];
	if (!hit) return false;
	const currentDistance = pointDistance(point, center);
	const fullDistance = Math.max(pointDistance(hit, center), PRECISION);
	return (
		round(currentDistance / fullDistance, 6) > 0.9 &&
		(currentDistance - fullDistance > FIXED_BINDING_DISTANCE ||
			pointDistanceSq(point, hit) < PRECISION)
	);
}
