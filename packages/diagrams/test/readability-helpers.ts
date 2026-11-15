/** Independent geometric oracles shared by graph and family rendering tests. */
import {
	candidateRouteQuality,
	canvasCornerRadius,
	routingQualityScale,
	wrappedLabelWidth,
	wrapTextToWidth,
	canvasOutlineContains,
	canvasShapeOutline,
	isCanvasComposedShape,
	type CanvasSpec,
} from "@sketchi/drawing";

type Point = { readonly x: number; readonly y: number };

const arrowsOf = (scene: CanvasSpec) =>
	scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : []));
const nodesOf = (scene: CanvasSpec) =>
	scene.elements.flatMap((element) =>
		element.type === "node" && !element.nodeId.endsWith(":core") ? [element] : [],
	);

/** A route's corners alone, so a line crossing it where it runs straight on counts once. */
function corners(points: readonly Point[]): Point[] {
	return points.filter((p, i) => {
		const [a, b] = [points[i - 1], points[i + 1]];
		return (
			!a ||
			!b ||
			!(
				(Math.abs(a.x - p.x) < 0.01 && Math.abs(p.x - b.x) < 0.01) ||
				(Math.abs(a.y - p.y) < 0.01 && Math.abs(p.y - b.y) < 0.01)
			)
		);
	});
}

/** Interior crossings between the axis-aligned runs of different arrows. */
export function crossings(scene: CanvasSpec): string[] {
	const arrows = arrowsOf(scene).map((arrow) => ({ ...arrow, points: corners(arrow.points) }));
	const found: string[] = [];
	const inside = (value: number, p: number, q: number) =>
		value > Math.min(p, q) + 0.01 && value < Math.max(p, q) - 0.01;
	const horizontal = (p: Point, q: Point) => Math.abs(p.y - q.y) < 0.01;
	const vertical = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.01;
	for (const [index, a] of arrows.entries())
		for (const b of arrows.slice(index + 1))
			for (const [i, p] of a.points.slice(0, -1).entries())
				for (const [j, r] of b.points.slice(0, -1).entries()) {
					const [q, u] = [a.points[i + 1]!, b.points[j + 1]!];
					const [h0, h1, v0, v1] =
						horizontal(p, q) && vertical(r, u)
							? [p, q, r, u]
							: vertical(p, q) && horizontal(r, u)
								? [r, u, p, q]
								: [];
					if (h0 && h1 && v0 && v1 && inside(v0.x, h0.x, h1.x) && inside(h0.y, v0.y, v1.y))
						found.push(`${a.edgeId} x ${b.edgeId}`);
				}
	return found;
}

/** A node's drawn outline as a polygon: its rectangle, diamond, or ellipse finely sampled. */
function outline(node: ReturnType<typeof nodesOf>[number]): Point[] {
	const [cx, cy, rx, ry] = [
		node.x + node.width / 2,
		node.y + node.height / 2,
		node.width / 2,
		node.height / 2,
	];
	if (node.shape === "ellipse" || node.shape === "circle")
		return Array.from({ length: 360 }, (_, i) => ({
			x: cx + rx * Math.cos((i * Math.PI) / 180),
			y: cy + ry * Math.sin((i * Math.PI) / 180),
		}));
	if (node.shape === "diamond")
		return [
			{ x: cx, y: node.y },
			{ x: node.x + node.width, y: cy },
			{ x: cx, y: node.y + node.height },
			{ x: node.x, y: cy },
		];
	return [
		{ x: node.x, y: node.y },
		{ x: node.x + node.width, y: node.y },
		{ x: node.x + node.width, y: node.y + node.height },
		{ x: node.x, y: node.y + node.height },
	];
}

function pointToSegment(p: Point, a: Point, b: Point): number {
	const [dx, dy] = [b.x - a.x, b.y - a.y];
	const length = dx * dx + dy * dy;
	const t =
		length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
	return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function segmentGap(a: Point, b: Point, c: Point, d: Point): number {
	const cross = (o: Point, p: Point, q: Point) =>
		(p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
	if (cross(c, d, a) * cross(c, d, b) < 0 && cross(a, b, c) * cross(a, b, d) < 0) return 0;
	return Math.min(
		pointToSegment(a, c, d),
		pointToSegment(b, c, d),
		pointToSegment(c, a, b),
		pointToSegment(d, a, b),
	);
}

/** Each line's least gap to the outline of every node it neither leaves nor enters. */
export function outlineGaps(scene: CanvasSpec): { edge: string; gap: number; node: string }[] {
	const nodes = nodesOf(scene);
	return arrowsOf(scene).flatMap((arrow) =>
		nodes
			.filter((node) => node.nodeId !== arrow.sourceNodeId && node.nodeId !== arrow.targetNodeId)
			.map((node) => {
				const polygon = outline(node);
				const gap = Math.min(
					...arrow.points
						.slice(0, -1)
						.flatMap((p, i) =>
							polygon.map((c, k) =>
								segmentGap(p, arrow.points[i + 1]!, c, polygon[(k + 1) % polygon.length]!),
							),
						),
				);
				return { edge: arrow.edgeId, gap, node: node.nodeId };
			}),
	);
}

/**
 * Line ends that meet a rounded box within a corner's curve rather than on the
 * straight part of a side: nearer the corner, along the side, than its radius.
 */
export function cornerEnds(scene: CanvasSpec): string[] {
	const nodes = new Map(nodesOf(scene).map((node) => [node.nodeId, node]));
	return arrowsOf(scene).flatMap((arrow) =>
		(
			[
				[arrow.sourceNodeId, arrow.points[0]],
				[arrow.targetNodeId, arrow.points.at(-1)!],
			] as const
		).flatMap(([id, end]) => {
			const node = id === undefined ? undefined : nodes.get(id);
			const radius = node ? canvasCornerRadius(node) : 0;
			if (!node || radius === 0) return [];
			const upright = Math.abs(end.x - node.x) < 0.5 || Math.abs(end.x - node.x - node.width) < 0.5;
			const along = upright
				? Math.min(end.y - node.y, node.y + node.height - end.y)
				: Math.min(end.x - node.x, node.x + node.width - end.x);
			return along < radius - 0.01
				? [`${arrow.edgeId} ${along.toFixed(1)} px along ${id} from its corner (radius ${radius})`]
				: [];
		}),
	);
}

/**
 * Lines that pass through or touch another line's arrowhead at the size a
 * reader sees the export: a head a line runs through reads as pointing that
 * line into the head's target.
 */
export function arrowheadsCrossed(scene: CanvasSpec): string[] {
	const routes = arrowsOf(scene).map((arrow) => ({
		id: arrow.edgeId,
		points: arrow.points,
		sourceId: arrow.sourceNodeId,
		targetId: arrow.targetNodeId,
		endArrowhead: arrow.endArrowhead !== null,
	}));
	const quality = candidateRouteQuality(routes, routingQualityScale(scene));
	return routes.flatMap((route) =>
		quality(route).arrowheadsCrossed > 0 ? [`${route.id} runs through an arrowhead`] : [],
	);
}

/** A transition label's box as Excalidraw wraps and draws it. */
function labelBox(label: {
	fontSize: number;
	maxWidth?: number;
	text: string;
	x: number;
	y: number;
}) {
	const maxWidth = label.maxWidth ?? 160;
	const text = wrapTextToWidth(label.text, maxWidth, label.fontSize);
	const width = wrappedLabelWidth(text, label.fontSize, maxWidth);
	const height = Math.ceil(text.split("\n").length * label.fontSize * 1.35);
	return { x: label.x - width / 2, y: label.y - height / 2, width, height };
}

/** Room every other line keeps from a label past its own line's distance. */
const LABEL_OWN_MARGIN = 8;

/**
 * Labels not clearly nearer their own line than any other: less than half again
 * as near, or nearer than their own line's distance plus `LABEL_OWN_MARGIN`.
 */
export function ambiguousLabels(scene: CanvasSpec): string[] {
	const arrows = arrowsOf(scene);
	const distance = (box: ReturnType<typeof labelBox>, points: readonly Point[]) =>
		Math.min(
			...points.slice(0, -1).map((p, i) => {
				const q = points[i + 1]!;
				const dx = Math.max(0, box.x - Math.max(p.x, q.x), Math.min(p.x, q.x) - box.x - box.width);
				const dy = Math.max(0, box.y - Math.max(p.y, q.y), Math.min(p.y, q.y) - box.y - box.height);
				return Math.hypot(dx, dy);
			}),
		);
	return scene.elements.flatMap((element) => {
		if (element.type !== "text" || element.containerId) return [];
		const own = arrows.find((arrow) => `${arrow.id}:label` === element.id);
		if (!own) return [];
		const box = labelBox(element);
		const mine = distance(box, own.points);
		const nearest = Math.min(
			...arrows.filter((arrow) => arrow !== own).map((arrow) => distance(box, arrow.points)),
		);
		return nearest < Math.max(1.5 * mine, mine + LABEL_OWN_MARGIN)
			? [`${own.edgeId}: ${mine.toFixed(0)} px own, ${nearest.toFixed(0)} px other`]
			: [];
	});
}

type Box = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

/** A line's points every 2 units, its first `start` and last `end` units left out. */
function along(points: readonly Point[], start = 0, end = 0): Point[] {
	const samples = points.slice(1).flatMap((point, index) => {
		const from = points[index]!;
		const steps = Math.max(1, Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / 2));
		return Array.from({ length: steps }, (_, step) => ({
			x: from.x + ((point.x - from.x) * (step + 1)) / steps,
			y: from.y + ((point.y - from.y) * (step + 1)) / steps,
		}));
	});
	return samples.slice(Math.ceil(start / 2), samples.length - Math.ceil(end / 2));
}

const within = (point: Point, box: Box, inset: number) =>
	point.x > box.x + inset &&
	point.x < box.x + box.width - inset &&
	point.y > box.y + inset &&
	point.y < box.y + box.height - inset;

/**
 * Whether a point lies inside the shape a node draws: a diamond's, an
 * ellipse's or a composed shape's outline, else its box.
 */
function insideNode(point: Point, node: Box & { readonly shape: string }): boolean {
	if (isCanvasComposedShape(node.shape))
		return canvasOutlineContains(canvasShapeOutline({ ...node, shape: node.shape }), point);
	if (node.shape !== "diamond" && node.shape !== "ellipse" && node.shape !== "circle")
		return within(point, node, 0.5);
	const [halfWidth, halfHeight] = [node.width / 2, node.height / 2];
	const dx = Math.abs(point.x - node.x - halfWidth) / halfWidth;
	const dy = Math.abs(point.y - node.y - halfHeight) / halfHeight;
	const inner = 1 - 0.5 / Math.min(halfWidth, halfHeight);
	return node.shape === "diamond" ? dx + dy < inner : dx * dx + dy * dy < inner * inner;
}

/**
 * Where a scene's curved lines stray: into a node, their own ends' nodes
 * included past the straight runs that meet them; into a zone or group
 * neither end sits in; or out of one both ends sit in.
 */
export function strays(scene: CanvasSpec): string[] {
	const nodes = scene.elements.flatMap((e) =>
		e.type === "node" && e.rendererRole === undefined ? [e] : [],
	);
	const regions = scene.elements.flatMap((e) =>
		e.type === "frame" || (e.type === "node" && e.rendererRole === "zone") ? [e] : [],
	);
	const boxOf = new Map(nodes.map((node) => [node.nodeId, node]));
	return scene.elements.flatMap((arrow) => {
		if (arrow.type !== "arrow") return [];
		const found: string[] = [];
		for (const node of nodes) {
			const [source, target] = [
				node.nodeId === arrow.sourceNodeId,
				node.nodeId === arrow.targetNodeId,
			];
			const samples = along(arrow.points, source ? 18 : 0, target ? 32 : 0);
			if (samples.some((point) => insideNode(point, node)))
				found.push(`${arrow.edgeId} enters ${node.nodeId}`);
		}
		const [source, target] = [boxOf.get(arrow.sourceNodeId), boxOf.get(arrow.targetNodeId)];
		const samples = along(arrow.points);
		for (const region of regions) {
			const holds = (node: Box | undefined) => node !== undefined && within(node, region, -0.5);
			const [from, to] = [holds(source), holds(target)];
			if (!from && !to && samples.some((point) => within(point, region, 0.5)))
				found.push(`${arrow.edgeId} enters ${region.id}`);
			if (from && to && samples.some((point) => !within(point, region, -0.5)))
				found.push(`${arrow.edgeId} leaves ${region.id}`);
		}
		return found;
	});
}

/**
 * Width over height, either way up, of a scene in the hosted PNG's 20-unit
 * frame, in place of the scene's own padding.
 */
export const exportAspect = ({ width, height }: CanvasSpec, padding: number) =>
	(Math.max(width, height) - 2 * padding + 40) / (Math.min(width, height) - 2 * padding + 40);
