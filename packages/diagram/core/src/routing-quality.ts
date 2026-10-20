/**
 * Reader-scale routing defects from the visual taxonomy (v1.1): endpoint jogs,
 * near-coincident corridors and touching arrowheads. Thresholds are pixels in
 * the exported PNG fitted to 2000 px on its long side, so callers convert
 * scene units with {@link routingQualityScale} instead of fixed canvas units.
 */

interface Point {
	readonly x: number;
	readonly y: number;
}

export interface RoutingQualityArrow {
	readonly id: string;
	readonly points: readonly Point[];
	readonly sourceId?: string | null;
	readonly targetId?: string | null;
	/** Excalidraw draws an "arrow" head at the last point unless this is false. */
	readonly endArrowhead?: boolean;
	/**
	 * The length of the final run the head will be drawn on, when it is longer
	 * than these points' last segment: a stub reserved for a line not yet routed.
	 */
	readonly headRun?: number;
}

export interface RoutingQualityFinding {
	readonly kind: "endpoint-jog" | "near-coincident-corridor" | "touching-arrowheads";
	readonly arrowIds: readonly string[];
	/** Which end of the arrow an endpoint jog is near. */
	readonly endpoint?: "start" | "end";
	readonly message: string;
}

/** Long side of the image a reader judges, in pixels. */
const FITTED_LONG_SIDE_PX = 2000;
/** Sketchi PNG export padding per side, in scene units (browser-renderer EXPORT_PADDING). */
const EXPORT_PADDING = 20;
/** A kink this close to an endpoint reads as a port jog... */
const JOG_WINDOW_PX = 90;
/** ...unless the sideways step is a deliberate column or row change. */
const WIDE_BEND_PX = 150;
/** Parallel runs closer than this read as one doubled line (13-20 px in labeled images). */
const CORRIDOR_GAP_PX = 24;
/** Shorter side-by-side runs are corners or crossings, not corridors. */
const CORRIDOR_RUN_PX = 30;
/** Arrowheads need at least this much visible space between them. */
const ARROWHEAD_GAP_PX = 8;
/** Excalidraw "arrow" head: 25 units long (at most half the last segment), wings 20 degrees off axis. */
const ARROWHEAD_SIZE = 25;
const ARROWHEAD_ANGLE = (20 * Math.PI) / 180;
const STROKE_WIDTH = 2;
const EPSILON = 0.01;

/** Fitted pixels per scene unit for content of this size exported with Sketchi's PNG padding. */
export function routingQualityScale(content: { width: number; height: number }): number {
	return FITTED_LONG_SIDE_PX / (Math.max(content.width, content.height, 1) + 2 * EXPORT_PADDING);
}

/** Scene-unit distance below which parallel runs read as one line at this scale. */
export function routingCorridorGap(scale: number): number {
	return CORRIDOR_GAP_PX / scale;
}

/** Drop repeated points and pass-through points so each remaining point is a real turn. */
function corners(points: readonly Point[]): Point[] {
	const result: Point[] = [];
	for (const point of points) {
		const last = result.at(-1);
		if (last && Math.hypot(point.x - last.x, point.y - last.y) <= EPSILON) continue;
		const before = result.at(-2);
		if (
			before &&
			last &&
			Math.abs(
				(last.x - before.x) * (point.y - last.y) - (last.y - before.y) * (point.x - last.x),
			) <= EPSILON &&
			(last.x - before.x) * (point.x - last.x) + (last.y - before.y) * (point.y - last.y) > 0
		) {
			result[result.length - 1] = point;
			continue;
		}
		result.push(point);
	}
	return result;
}

interface Run {
	readonly horizontal: boolean;
	readonly at: number;
	readonly min: number;
	readonly max: number;
	readonly first: boolean;
	readonly last: boolean;
}

function runs(points: readonly Point[]): Run[] {
	const result: Run[] = [];
	for (let index = 0; index < points.length - 1; index += 1) {
		const start = points[index]!;
		const end = points[index + 1]!;
		const horizontal = Math.abs(start.y - end.y) <= EPSILON;
		if (!horizontal && Math.abs(start.x - end.x) > EPSILON) continue;
		result.push({
			horizontal,
			at: horizontal ? start.y : start.x,
			min: Math.min(horizontal ? start.x : start.y, horizontal ? end.x : end.y),
			max: Math.max(horizontal ? start.x : start.y, horizontal ? end.x : end.y),
			first: index === 0,
			last: index === points.length - 2,
		});
	}
	return result;
}

/**
 * A jog is a sideways step between two runs heading the same way, narrower than
 * a deliberate bend and at most half the run it interrupts, whose corner sits
 * within the jog window of an endpoint. A staircase of comparable runs is a
 * deliberate bend, not a jog. Each arrow end counts once.
 */
function endpointJogs(arrow: RoutingQualityArrow, scale: number): RoutingQualityFinding[] {
	const points = corners(arrow.points);
	const start = points[0];
	const end = points.at(-1);
	if (!start || !end) return [];
	const jogs = new Map<"start" | "end", number>();
	for (let index = 1; index < points.length - 2; index += 1) {
		const [a, b, c, d] = [
			points[index - 1]!,
			points[index]!,
			points[index + 1]!,
			points[index + 2]!,
		];
		const before = { x: b.x - a.x, y: b.y - a.y };
		const step = { x: c.x - b.x, y: c.y - b.y };
		const after = { x: d.x - c.x, y: d.y - c.y };
		const axisAligned = [before, step, after].every(
			(v) => Math.abs(v.x) <= EPSILON || Math.abs(v.y) <= EPSILON,
		);
		const sameHeading =
			Math.abs(before.x * after.y - before.y * after.x) <= EPSILON &&
			before.x * after.x + before.y * after.y > 0;
		const sideways = Math.abs(before.x * step.x + before.y * step.y) <= EPSILON;
		const width = Math.hypot(step.x, step.y);
		if (!axisAligned || !sameHeading || !sideways || width * scale >= WIDE_BEND_PX) continue;
		if (
			!jogs.has("end") &&
			Math.hypot(end.x - c.x, end.y - c.y) * scale <= JOG_WINDOW_PX &&
			2 * width <= Math.hypot(before.x, before.y)
		)
			jogs.set("end", width);
		else if (
			!jogs.has("start") &&
			Math.hypot(b.x - start.x, b.y - start.y) * scale <= JOG_WINDOW_PX &&
			2 * width <= Math.hypot(after.x, after.y)
		)
			jogs.set("start", width);
	}
	return [...jogs].map(([endpoint, width]) => ({
		kind: "endpoint-jog",
		arrowIds: [arrow.id],
		endpoint,
		message: `Arrow "${arrow.id}" steps ${width.toFixed(1)} units sideways near its ${endpoint === "end" ? "arrowhead" : "start"}.`,
	}));
}

/** Some pair of runs is parallel, closer than the corridor gap and long enough to read as one line. */
function runsBeside(
	a: RoutingQualityArrow,
	left: readonly Run[],
	b: RoutingQualityArrow,
	right: readonly Run[],
	scale: number,
): boolean {
	return left.some((x) =>
		right.some((y) => {
			if (x.horizontal !== y.horizontal || Math.abs(x.at - y.at) * scale >= CORRIDOR_GAP_PX)
				return false;
			const overlap = Math.min(x.max, y.max) - Math.max(x.min, y.min);
			if (overlap * scale < CORRIDOR_RUN_PX) return false;
			// Short stubs side by side at one node are arrivals or departures, not corridors.
			const sharedStub =
				(x.first && y.first && Boolean(a.sourceId) && a.sourceId === b.sourceId) ||
				(x.last && y.last && Boolean(a.targetId) && a.targetId === b.targetId);
			return !(sharedStub && overlap * scale <= JOG_WINDOW_PX);
		}),
	);
}

function corridorFinding(
	a: RoutingQualityArrow,
	b: RoutingQualityArrow,
	scale: number,
): RoutingQualityFinding | undefined {
	return runsBeside(a, runs(corners(a.points)), b, runs(corners(b.points)), scale)
		? {
				kind: "near-coincident-corridor",
				arrowIds: [a.id, b.id],
				message: `Arrows "${a.id}" and "${b.id}" run side by side closer than ${CORRIDOR_GAP_PX} px.`,
			}
		: undefined;
}

function arrowhead(arrow: RoutingQualityArrow): Point[] | undefined {
	if (arrow.endArrowhead === false) return undefined;
	const points = arrow.points.filter(
		(p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1]!.x, p.y - all[i - 1]!.y) > EPSILON,
	);
	const tip = points.at(-1);
	const previous = points.at(-2);
	if (!tip || !previous) return undefined;
	const length = Math.hypot(tip.x - previous.x, tip.y - previous.y);
	const size = Math.min(ARROWHEAD_SIZE, Math.max(length, arrow.headRun ?? 0) / 2);
	const ux = (tip.x - previous.x) / length;
	const uy = (tip.y - previous.y) / length;
	const wing = (angle: number) => ({
		x: tip.x - size * (ux * Math.cos(angle) - uy * Math.sin(angle)),
		y: tip.y - size * (uy * Math.cos(angle) + ux * Math.sin(angle)),
	});
	return [tip, wing(ARROWHEAD_ANGLE), wing(-ARROWHEAD_ANGLE)];
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const t =
		dx === 0 && dy === 0
			? 0
			: Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
	const cross = (o: Point, p: Point, q: Point) =>
		(p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
	return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

function triangleDistance(left: readonly Point[], right: readonly Point[]): number {
	const edges = (t: readonly Point[]) => t.map((p, i) => [p, t[(i + 1) % t.length]!] as const);
	let distance = Infinity;
	for (const [a, b] of edges(left))
		for (const [c, d] of edges(right)) {
			if (segmentsIntersect(a, b, c, d)) return 0;
			distance = Math.min(
				distance,
				pointSegmentDistance(a, c, d),
				pointSegmentDistance(b, c, d),
				pointSegmentDistance(c, a, b),
				pointSegmentDistance(d, a, b),
			);
		}
	return distance;
}

function arrowheadFinding(
	a: RoutingQualityArrow,
	b: RoutingQualityArrow,
	scale: number,
): RoutingQualityFinding | undefined {
	const left = arrowhead(a);
	const right = arrowhead(b);
	return left && right && (triangleDistance(left, right) - STROKE_WIDTH) * scale < ARROWHEAD_GAP_PX
		? {
				kind: "touching-arrowheads",
				arrowIds: [a.id, b.id],
				message: `Arrowheads of "${a.id}" and "${b.id}" touch.`,
			}
		: undefined;
}

function pairFindings(
	a: RoutingQualityArrow,
	b: RoutingQualityArrow,
	scale: number,
): RoutingQualityFinding[] {
	return [corridorFinding(a, b, scale), arrowheadFinding(a, b, scale)].filter(
		(finding): finding is RoutingQualityFinding => finding !== undefined,
	);
}

/** Every endpoint jog, near-coincident corridor and touching arrowhead pair at this scale. */
export function routingQualityFindings(
	arrows: readonly RoutingQualityArrow[],
	scale: number,
): RoutingQualityFinding[] {
	const pairs = arrows.flatMap((a, index) =>
		arrows.slice(index + 1).flatMap((b) => pairFindings(a, b, scale)),
	);
	return [
		...arrows.flatMap((arrow) => endpointJogs(arrow, scale)),
		...pairs.filter((finding) => finding.kind === "near-coincident-corridor"),
		...pairs.filter((finding) => finding.kind === "touching-arrowheads"),
	];
}

function segmentTriangleDistance(a: Point, b: Point, triangle: readonly Point[]): number {
	let distance = Infinity;
	for (const [index, c] of triangle.entries()) {
		const d = triangle[(index + 1) % triangle.length]!;
		if (segmentsIntersect(a, b, c, d)) return 0;
		distance = Math.min(
			distance,
			pointSegmentDistance(a, c, d),
			pointSegmentDistance(b, c, d),
			pointSegmentDistance(c, a, b),
			pointSegmentDistance(d, a, b),
		);
	}
	return distance;
}

/**
 * How many placed arrowheads, other than those of `id`, the segment from one
 * point to another passes through or comes within the reader's arrowhead gap of.
 */
export function arrowheadsNear(
	placed: readonly RoutingQualityArrow[],
	scale: number,
): (from: Point, to: Point, id: string) => number {
	const reach = ARROWHEAD_GAP_PX / scale + STROKE_WIDTH;
	const heads = placed.flatMap((arrow) => {
		const head = arrowhead(arrow);
		return head ? [{ bounds: boxOf(head, reach), head, id: arrow.id }] : [];
	});
	return (from, to, id) => {
		const bounds = boxOf([from, to]);
		// A line's reserved stub and its routed line share one head.
		const near = new Set<string>();
		for (const head of heads)
			if (
				head.id !== id &&
				!near.has(head.id) &&
				boxesMeet(bounds, head.bounds) &&
				(segmentTriangleDistance(from, to, head.head) - STROKE_WIDTH) * scale < ARROWHEAD_GAP_PX
			)
				near.add(head.id);
		return near.size;
	};
}

/**
 * Scores candidate routes for one edge against arrows already placed: its
 * endpoint jogs, how many placed arrows it runs beside and how many placed
 * arrowheads it passes through. Its own arrowhead depends on the port, not the
 * path, so it is not scored here.
 */
export function candidateRouteQuality(
	placed: readonly RoutingQualityArrow[],
	scale: number,
): (candidate: RoutingQualityArrow) => {
	arrowheadsCrossed: number;
	corridors: number;
	jogs: number;
} {
	// Anything farther than this from a candidate cannot run beside it or touch its path.
	const reach = Math.max(CORRIDOR_GAP_PX, ARROWHEAD_GAP_PX) / scale + STROKE_WIDTH;
	const prepared = placed.map((arrow) => {
		const head = arrowhead(arrow);
		return {
			arrow,
			// The head's wings reach past the shaft; the broad phase must include them.
			bounds: boxOf([...arrow.points, ...(head ?? [])]),
			head,
			headBounds: head ? boxOf(head) : undefined,
			runs: runs(corners(arrow.points)),
		};
	});
	return (candidate) => {
		const own = runs(corners(candidate.points));
		const near = boxOf(candidate.points, reach);
		const segments = candidate.points.slice(1).map((point, index) => {
			const from = candidate.points[index]!;
			return { bounds: boxOf([from, point], reach), from, to: point };
		});
		const others = prepared.filter(
			({ arrow, bounds }) => arrow.id !== candidate.id && boxesMeet(near, bounds),
		);
		const beside = new Set(
			others
				.filter(({ arrow, runs: other }) => runsBeside(candidate, own, arrow, other, scale))
				.map(({ arrow }) => arrow.id),
		);
		const crossed = new Set(
			others
				.filter(
					({ head, headBounds }) =>
						head &&
						segments.some(
							({ bounds, from, to }) =>
								boxesMeet(bounds, headBounds!) &&
								(segmentTriangleDistance(from, to, head) - STROKE_WIDTH) * scale < ARROWHEAD_GAP_PX,
						),
				)
				.map(({ arrow }) => arrow.id),
		);
		return {
			arrowheadsCrossed: crossed.size,
			corridors: beside.size,
			jogs: endpointJogs(candidate, scale).length,
		};
	};
}

interface Box {
	readonly maxX: number;
	readonly maxY: number;
	readonly minX: number;
	readonly minY: number;
}

function boxOf(points: readonly Point[], margin = 0): Box {
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	return {
		maxX: Math.max(...xs) + margin,
		maxY: Math.max(...ys) + margin,
		minX: Math.min(...xs) - margin,
		minY: Math.min(...ys) - margin,
	};
}

function boxesMeet(a: Box, b: Box): boolean {
	return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}
