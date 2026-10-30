import { describe, expect, it } from "vitest";
import {
	candidateRouteQuality,
	canvasCornerRadius,
	crossingFixtures,
	crossingStateMachines,
	routingFixtures,
	routingQualityScale,
	wrappedLabelWidth,
	wrapTextToWidth,
} from "@sketchi/diagram-core";
import { renderIntermediateDiagram, type RenderedDiagramScene } from "./scene";
import { renderStateMachineDiagram } from "./state-machine";

type Point = { readonly x: number; readonly y: number };

const arrowsOf = (scene: RenderedDiagramScene) =>
	scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : []));
const nodesOf = (scene: RenderedDiagramScene) =>
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
function crossings(scene: RenderedDiagramScene): string[] {
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
function outlineGaps(scene: RenderedDiagramScene): { edge: string; gap: number; node: string }[] {
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
function cornerEnds(scene: RenderedDiagramScene): string[] {
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
function arrowheadsCrossed(scene: RenderedDiagramScene): string[] {
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

/** Room every line keeps from the outline of a node it passes. */
const NODE_CLEARANCE = 12;

/**
 * Crossings each fixture drew on main (fd92ae12) and draws now, counting a line
 * that crosses a route where the route runs straight on.
 */
const CROSSINGS: Readonly<Record<keyof typeof crossingFixtures, readonly [number, number]>> = {
	"incident-escalation": [3, 0],
	"incident-escalation-bridge": [3, 0],
	"incident-escalation-early-bridge": [3, 0],
	"incident-escalation-shared-resolve": [2, 0],
	"incident-escalation-monitoring-merge": [1, 0],
	"subscription-renewal-dunning": [2, 0],
	"subscription-renewal-grace": [2, 0],
	"patient-intake-scheduling": [1, 0],
	"patient-intake-merge-detour": [0, 0],
	"patient-intake-merge-crossing": [1, 0],
	"patient-intake-merge-long": [0, 0],
	"procurement-vendor-approval": [1, 0],
	"procurement-vendor-approval-legal": [2, 0],
	"restaurant-waitlist": [1, 0],
	"restaurant-waitlist-recheck": [1, 0],
	"grouped-expense-approval": [1, 0],
	"content-moderation": [0, 0],
};

const flowcharts = Object.keys(crossingFixtures) as (keyof typeof crossingFixtures)[];
const scenes = new Map(
	flowcharts.map((name) => [name, renderIntermediateDiagram(crossingFixtures[name])] as const),
);

describe("avoidable crossings in generated flowcharts", () => {
	if (process.env.PRINT_CROSSINGS)
		console.log(flowcharts.map((name) => `${name}: ${crossings(scenes.get(name)!).length}`));

	it.each(flowcharts)("draws %s with fewer crossings than main, or none", (name) => {
		const [main, now] = CROSSINGS[name];
		expect(crossings(scenes.get(name)!).length).toBeLessThanOrEqual(now);
		expect(now).toBeLessThanOrEqual(Math.max(0, main - 1));
	});

	it.each(flowcharts)("keeps every line of %s clear of every other line's arrowhead", (name) => {
		expect(arrowheadsCrossed(scenes.get(name)!)).toEqual([]);
	});

	it.each(["TB", "BT", "LR", "RL"] as const)(
		"keeps every line of each crossing fixture clear of other arrowheads in %s",
		(direction) => {
			const crossed = flowcharts.flatMap((name) =>
				arrowheadsCrossed(
					renderIntermediateDiagram({
						...crossingFixtures[name],
						layout: { direction, edgeRouting: "orthogonal" },
					}),
				).map((finding) => `${name}: ${finding}`),
			);
			expect(crossed).toEqual([]);
		},
	);

	it.each(flowcharts)("meets every rounded node of %s on the straight part of a side", (name) => {
		expect(cornerEnds(scenes.get(name)!)).toEqual([]);
	});

	it("keeps each line clear of every node it passes, rounded and pointed nodes included", () => {
		const close = flowcharts.flatMap((name) =>
			outlineGaps(scenes.get(name)!)
				.filter(({ gap }) => gap < NODE_CLEARANCE)
				.map(({ edge, gap, node }) => `${name}: ${edge} ${gap.toFixed(1)} px from ${node}`),
		);
		expect(close).toEqual([]);
	});

	it.each(["TB", "BT", "LR", "RL"] as const)(
		"keeps each routing fixture's lines clear of the nodes they pass in %s",
		(direction) => {
			const close = Object.entries(routingFixtures).flatMap(([name, fixture]) =>
				outlineGaps(
					renderIntermediateDiagram({
						...fixture,
						layout: { direction, edgeRouting: "orthogonal" },
					}),
				)
					.filter(({ gap }) => gap < NODE_CLEARANCE)
					.map(({ edge, gap, node }) => `${name}: ${edge} ${gap.toFixed(1)} px from ${node}`),
			);
			expect(close).toEqual([]);
		},
	);
});

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
function ambiguousLabels(scene: RenderedDiagramScene): string[] {
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

describe("avoidable crossings in generated state machines", () => {
	const machines = Object.keys(crossingStateMachines) as (keyof typeof crossingStateMachines)[];
	const layouts = machines.flatMap((name) =>
		([undefined, "TB", "LR"] as const).map((direction) => ({
			name,
			direction: direction ?? "auto",
			scene: renderStateMachineDiagram(
				direction
					? { ...crossingStateMachines[name], layout: { direction } }
					: crossingStateMachines[name],
			),
		})),
	);

	it.each(layouts)("draws $name ($direction) without crossings", ({ scene }) => {
		expect(crossings(scene)).toEqual([]);
	});

	it.each(layouts)(
		"sets each of $name's ($direction) labels clearly nearer its own line than any other",
		({ scene }) => {
			expect(ambiguousLabels(scene)).toEqual([]);
		},
	);

	it.each(layouts)(
		"meets each of $name's ($direction) states on the straight part of a side",
		({ scene }) => {
			// Round 22, Sol: seek's self-loop left Playing's foot and came back into
			// its side 16 px from the corner, inside the 27.5 px curve.
			expect(cornerEnds(scene)).toEqual([]);
		},
	);
});
