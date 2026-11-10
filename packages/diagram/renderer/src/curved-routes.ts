import { canvasFrameNameBox, wrappedLabelWidth, wrapTextToWidth } from "@sketchi/diagram-core";
import type {
	ArrowSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	ScenePoint,
	TextSceneElement,
} from "./scene.js";

/**
 * Curved lines follow the orthogonal routes, so they keep every guarantee those
 * routes keep (no line through a node, none along another, labels clear, ports
 * where the router put them): each corner becomes a quarter curve as wide as
 * room allows, up to CURVE_RADIUS, and each end keeps a straight run, the
 * arrowhead's on the arrival, so a line still leaves and meets a node square.
 */
const CURVE_RADIUS = 56;
/** Straight run a departure keeps from its port before it bends. */
const DEPARTURE_RUN = 18;
/** Straight run an arrival keeps into its arrowhead (Excalidraw draws heads 25 long). */
const ARRIVAL_RUN = 32;
/** Room a curve keeps from every node it passes, as the orthogonal routes do. */
const CURVE_CLEARANCE = 12;
/** Each corner's curve is sampled at these points, its ends exact. */
const SAMPLES = [0.25, 0.5, 0.75] as const;
/**
 * Longest run between the points a curved line carries. Excalidraw draws a
 * smooth spline through them, which overshoots where long runs meet the short
 * ones a curve is sampled at, and wavers where points crowd a straight run;
 * runs split this finely keep it on the route.
 */
const POINT_SPACING = 40;
/** Radii tried for a line, as fractions of the widest its corners allow. */
const SCALES = [1, 0.5, 0.25, 0.125] as const;

const EPSILON = 0.01;

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function distance(a: ScenePoint, b: ScenePoint): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The route's corners alone: points that continue a straight run dropped. */
function corners(points: readonly ScenePoint[]): ScenePoint[] {
	const kept: ScenePoint[] = [];
	for (const point of points) {
		const last = kept.at(-1);
		if (last && distance(last, point) < EPSILON) continue;
		const before = kept.at(-2);
		if (
			before &&
			last &&
			Math.abs(
				(last.x - before.x) * (point.y - last.y) - (last.y - before.y) * (point.x - last.x),
			) < EPSILON
		)
			kept[kept.length - 1] = point;
		else kept.push(point);
	}
	return kept;
}

/**
 * The route with each corner turned through a quadratic curve `scale` of the
 * widest radius it has room for: half of a run between two corners, all of an
 * end's run but its straight part.
 */
export function curvedPoints(
	route: readonly ScenePoint[],
	scale = 1,
): [ScenePoint, ...ScenePoint[]] {
	const points = corners(route);
	if (points.length < 3) return points as [ScenePoint, ...ScenePoint[]];
	const curved: ScenePoint[] = [points[0]!];
	for (let index = 1; index < points.length - 1; index += 1) {
		const [before, at, after] = [points[index - 1]!, points[index]!, points[index + 1]!];
		const [incoming, outgoing] = [distance(before, at), distance(at, after)];
		const roomIn = index === 1 ? incoming - DEPARTURE_RUN : incoming / 2;
		const roomOut = index === points.length - 2 ? outgoing - ARRIVAL_RUN : outgoing / 2;
		const radius = Math.max(0, Math.min(CURVE_RADIUS, roomIn, roomOut)) * Math.max(0, scale);
		if (radius < 1) {
			curved.push(at);
			continue;
		}
		const from = {
			x: at.x - ((at.x - before.x) / incoming) * radius,
			y: at.y - ((at.y - before.y) / incoming) * radius,
		};
		const to = {
			x: at.x + ((after.x - at.x) / outgoing) * radius,
			y: at.y + ((after.y - at.y) / outgoing) * radius,
		};
		curved.push(from);
		for (const t of SAMPLES) {
			const u = 1 - t;
			curved.push({
				x: round(u * u * from.x + 2 * u * t * at.x + t * t * to.x),
				y: round(u * u * from.y + 2 * u * t * at.y + t * t * to.y),
			});
		}
		curved.push(to);
	}
	curved.push(points.at(-1)!);
	const even: ScenePoint[] = [curved[0]!];
	for (const [index, point] of curved.slice(1).entries()) {
		const from = curved[index]!;
		const steps = Math.ceil(distance(from, point) / POINT_SPACING);
		for (let step = 1; step <= steps; step += 1)
			even.push({
				x: from.x + ((point.x - from.x) * step) / steps,
				y: from.y + ((point.y - from.y) * step) / steps,
			});
	}
	// The ends stay exact: they sit on the nodes' outlines.
	return even.map((point, index) =>
		index === 0 || index === even.length - 1 ? point : { x: round(point.x), y: round(point.y) },
	) as [ScenePoint, ...ScenePoint[]];
}

function pointToSegment(point: ScenePoint, a: ScenePoint, b: ScenePoint): number {
	const [dx, dy] = [b.x - a.x, b.y - a.y];
	const length = dx * dx + dy * dy;
	const t =
		length === 0
			? 0
			: Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
	return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function segmentsCross(a: ScenePoint, b: ScenePoint, c: ScenePoint, d: ScenePoint): boolean {
	const side = (o: ScenePoint, p: ScenePoint, q: ScenePoint) =>
		(p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
	return side(c, d, a) * side(c, d, b) < -EPSILON && side(a, b, c) * side(a, b, d) < -EPSILON;
}

/** The least gap between a line and a node's box. */
function gapToNode(points: readonly ScenePoint[], node: NodeSceneElement): number {
	const box = [
		{ x: node.x, y: node.y },
		{ x: node.x + node.width, y: node.y },
		{ x: node.x + node.width, y: node.y + node.height },
		{ x: node.x, y: node.y + node.height },
	];
	let least = Infinity;
	for (const [index, p] of points.slice(0, -1).entries()) {
		const q = points[index + 1]!;
		const inside = (point: ScenePoint) =>
			point.x > node.x &&
			point.x < node.x + node.width &&
			point.y > node.y &&
			point.y < node.y + node.height;
		if (inside(p) || inside(q)) return 0;
		for (const [corner, c] of box.entries()) {
			const d = box[(corner + 1) % 4]!;
			if (segmentsCross(p, q, c, d)) return 0;
			least = Math.min(
				least,
				pointToSegment(c, p, q),
				pointToSegment(p, c, d),
				pointToSegment(q, c, d),
			);
		}
	}
	return least;
}

interface Box {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** A free label's box as Excalidraw wraps and draws it. */
function labelBox(label: TextSceneElement): Box {
	const maxWidth = label.maxWidth ?? 160;
	const text = wrapTextToWidth(label.text, maxWidth, label.fontSize);
	const width = wrappedLabelWidth(text, label.fontSize, maxWidth);
	const height = Math.ceil(text.split("\n").length * label.fontSize * (label.lineHeight ?? 1.35));
	return { x: label.x - width / 2, y: label.y - height / 2, width, height };
}

/** The line with its first `start` and last `end` units of length cut off. */
function trimmed(points: readonly ScenePoint[], start: number, end: number): ScenePoint[] {
	const cut = (line: readonly ScenePoint[], length: number): ScenePoint[] => {
		let left = length;
		for (const [index, point] of line.slice(1).entries()) {
			const from = line[index]!;
			const run = distance(from, point);
			if (run > left) {
				const t = left / run;
				return [
					{ x: from.x + (point.x - from.x) * t, y: from.y + (point.y - from.y) * t },
					...line.slice(index + 1),
				];
			}
			left -= run;
		}
		return [];
	};
	return cut(cut(points, start).reverse(), end).reverse();
}

/** Whether a point lies inside the shape a node draws, not only its box. */
function insideShape(point: ScenePoint, node: NodeSceneElement): boolean {
	const [halfWidth, halfHeight] = [node.width / 2, node.height / 2];
	const dx = Math.abs(point.x - node.x - halfWidth) / halfWidth;
	const dy = Math.abs(point.y - node.y - halfHeight) / halfHeight;
	const within = 1 - 0.5 / Math.min(halfWidth, halfHeight);
	if (node.shape === "diamond") return dx + dy < within;
	if (node.shape === "ellipse" || node.shape === "circle")
		return dx * dx + dy * dy < within * within;
	return dx < within && dy < within;
}

/** Whether a line, followed every 2 units, runs inside a node's shape. */
function entersShape(points: readonly ScenePoint[], node: NodeSceneElement): boolean {
	return points.slice(1).some((point, index) => {
		const from = points[index]!;
		const steps = Math.max(1, Math.ceil(distance(from, point) / 2));
		for (let step = 1; step <= steps; step += 1)
			if (
				insideShape(
					{
						x: from.x + ((point.x - from.x) * step) / steps,
						y: from.y + ((point.y - from.y) * step) / steps,
					},
					node,
				)
			)
				return true;
		return false;
	});
}

/** How a line meets a region: whether it enters or leaves it, and how often it crosses its outline. */
function regionPassage(points: readonly ScenePoint[], box: Box) {
	const outside = (point: ScenePoint) =>
		point.x < box.x - EPSILON ||
		point.x > box.x + box.width + EPSILON ||
		point.y < box.y - EPSILON ||
		point.y > box.y + box.height + EPSILON;
	const corners = [
		{ x: box.x, y: box.y },
		{ x: box.x + box.width, y: box.y },
		{ x: box.x + box.width, y: box.y + box.height },
		{ x: box.x, y: box.y + box.height },
	];
	let crossings = 0;
	for (const [index, point] of points.slice(1).entries())
		for (const [at, corner] of corners.entries())
			if (segmentsCross(points[index]!, point, corner, corners[(at + 1) % 4]!)) crossings += 1;
	return { enters: entersBox(points, box), leaves: points.some(outside), crossings };
}

/** Whether a line runs into a box's interior. */
function entersBox(points: readonly ScenePoint[], box: Box): boolean {
	const inside = (point: ScenePoint) =>
		point.x > box.x + EPSILON &&
		point.x < box.x + box.width - EPSILON &&
		point.y > box.y + EPSILON &&
		point.y < box.y + box.height - EPSILON;
	const corners = [
		{ x: box.x, y: box.y },
		{ x: box.x + box.width, y: box.y },
		{ x: box.x + box.width, y: box.y + box.height },
		{ x: box.x, y: box.y + box.height },
	];
	return points.some(
		(point, index) =>
			inside(point) ||
			(index > 0 &&
				corners.some((corner, at) =>
					segmentsCross(points[index - 1]!, point, corner, corners[(at + 1) % 4]!),
				)),
	);
}

/** Crossings and near touches between two lines' segments. */
function meetings(a: readonly ScenePoint[], b: readonly ScenePoint[], touch: number) {
	let [crossings, touches] = [0, 0];
	for (const [i, p] of a.slice(0, -1).entries())
		for (const [j, r] of b.slice(0, -1).entries()) {
			const [q, u] = [a[i + 1]!, b[j + 1]!];
			if (segmentsCross(p, q, r, u)) crossings += 1;
			else if (
				Math.min(
					pointToSegment(p, r, u),
					pointToSegment(q, r, u),
					pointToSegment(r, p, q),
					pointToSegment(u, p, q),
				) < touch
			)
				touches += 1;
		}
	return { crossings, touches };
}

/**
 * The scene with every line drawn as a curve along its route. A line's
 * corners curve as widely as room allows unless the curve would come nearer a
 * node than its route did (or than CURVE_CLEARANCE), its own ends' nodes
 * included once it leaves their straight runs, or enter its own ends' drawn
 * shapes there, which its route never does; or meet another line more than
 * its route did; or run into a label its route kept clear of; or enter, leave
 * or cross a zone, group or lane its route did not. Then they curve less, and
 * at worst stay square. Labels stay where the routes put them.
 */
export function curvedScene(scene: RenderedDiagramScene): RenderedDiagramScene {
	const nodes = scene.elements.flatMap((element) =>
		element.type === "node" && element.rendererRole === undefined ? [element] : [],
	);
	const arrows = scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : []));
	const labels = scene.elements.flatMap((element) =>
		element.type === "text" && element.containerId === undefined
			? [labelBox(element)]
			: element.type === "frame"
				? [canvasFrameNameBox(element)]
				: [],
	);
	// Zones, group frames and lanes: a curve keeps to the regions its route keeps to.
	const regions = scene.elements.flatMap((element): Box[] =>
		element.type === "frame" ||
		(element.type === "node" &&
			(element.rendererRole === "zone" ||
				element.rendererRole === "swimlane" ||
				element.rendererRole === "swimlane-header"))
			? [element]
			: [],
	);
	const drawn = new Map(arrows.map((arrow) => [arrow.id, arrow.points as readonly ScenePoint[]]));
	const touchGap = 4;
	for (const arrow of arrows) {
		const route = arrow.points;
		const passed = nodes.filter(
			(node) => node.nodeId !== arrow.sourceNodeId && node.nodeId !== arrow.targetNodeId,
		);
		// A line meets its own nodes only along the straight runs at its ends.
		const ends = nodes.flatMap((node) => {
			const [source, target] = [
				node.nodeId === arrow.sourceNodeId,
				node.nodeId === arrow.targetNodeId,
			];
			if (!source && !target) return [];
			const away = (points: readonly ScenePoint[]) =>
				trimmed(points, source ? DEPARTURE_RUN : 0, target ? ARRIVAL_RUN : 0);
			return [{ node, away, gap: Math.min(CURVE_CLEARANCE, gapToNode(away(route), node)) }];
		});
		const regionsCrossed = regions.map((box) => ({ box, route: regionPassage(route, box) }));
		const others = arrows.filter((other) => other !== arrow);
		const meetingsOf = (points: readonly ScenePoint[]) =>
			others.reduce(
				(sum, other) => {
					const met = meetings(points, drawn.get(other.id)!, touchGap);
					return { crossings: sum.crossings + met.crossings, touches: sum.touches + met.touches };
				},
				{ crossings: 0, touches: 0 },
			);
		const before = meetingsOf(route);
		const clearLabels = labels.filter((box) => !entersBox(route, box));
		const curve = SCALES.map((scale) => curvedPoints(route, scale)).find((points) => {
			if (clearLabels.some((box) => entersBox(points, box))) return false;
			if (
				passed.some(
					(node) =>
						gapToNode(points, node) < Math.min(CURVE_CLEARANCE, gapToNode(route, node)) - EPSILON,
				)
			)
				return false;
			for (const end of ends) {
				const away = end.away(points);
				if (gapToNode(away, end.node) < end.gap - EPSILON) return false;
				if (entersShape(away, end.node)) return false;
			}
			for (const { box, route: kept } of regionsCrossed) {
				const passage = regionPassage(points, box);
				if (
					passage.crossings > kept.crossings ||
					(passage.enters && !kept.enters) ||
					(passage.leaves && !kept.leaves)
				)
					return false;
			}
			const after = meetingsOf(points);
			return after.crossings <= before.crossings && after.touches <= before.touches;
		});
		// A line no curve suits stays square, its runs evenly spaced like a curve's.
		drawn.set(arrow.id, curve ?? curvedPoints(route, 0));
	}
	return {
		...scene,
		elements: scene.elements.map((element) =>
			element.type === "arrow"
				? ({ ...element, points: drawn.get(element.id)!, curved: true } as ArrowSceneElement)
				: element,
		),
	};
}
