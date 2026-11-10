import { describe, expect, it } from "vitest";
import {
	canvasOutlineContains,
	canvasShapeOutline,
	groupFixtures,
	isCanvasComposedShape,
	parseIntermediateDiagram,
	zoneFixtures,
	zoneStressFixtures,
} from "@sketchi/diagram-core";

import { renderGraphDiagram, renderIntermediateDiagram, type RenderedDiagramScene } from "./scene";

type Point = { readonly x: number; readonly y: number };
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
function strays(scene: RenderedDiagramScene): string[] {
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

describe("curved routes", () => {
	it("keeps a line out of its own nodes past the runs that meet them", () => {
		// Left to right, the revision loop leaves Revise's foot and turns back up
		// past it; a corner curved too widely cut back through Revise.
		const scene = renderIntermediateDiagram({
			...groupFixtures["grouped-approval"],
			layout: { direction: "LR", edgeRouting: "curved" },
		});
		expect(strays(scene)).toEqual([]);
	});

	// A composed shape's curved or tapered side sits inside its box, up to a
	// bucket's taper (24 here) at its foot, so a line's straight run there can
	// end inside the box and still be clear of the shape.
	it.each([
		["storage", "right", 65, { x: 600, y: 420 }, "left"],
		["storage", "left", 65, { x: -560, y: 420 }, "right"],
		["database", "bottom", 90, { x: 520, y: 520 }, "left"],
		["database", "top", 90, { x: 520, y: -380 }, "left"],
		["queue", "right", 60, { x: 600, y: 420 }, "left"],
		["queue", "left", 60, { x: -560, y: 420 }, "right"],
		["document", "bottom", 70, { x: 520, y: 520 }, "left"],
	] as const)(
		"curves a line leaving a %s's %s side, into neither node's drawn shape",
		(shape, side, offset, at, targetSide) => {
			const placement = new Map([
				["a", { x: 0, y: 0, width: 300, height: 200 }],
				["b", { ...at, width: 184, height: 72 }],
			]);
			const route = (source: string, target: string, anchors: Map<string, object>) =>
				renderGraphDiagram(
					parseIntermediateDiagram({
						id: "composed",
						title: "Composed",
						type: "flowchart",
						nodes: [
							{ id: "a", label: "Composed", kind: "start", shape },
							{ id: "b", label: "Step", kind: "end" },
						],
						edges: [{ id: "e", source, target }],
						layout: { direction: "TB", edgeRouting: "curved" },
					}),
					{ placement, anchors: anchors as never },
				);
			// Leaving the composed side, then arriving at it.
			for (const scene of [
				route(
					"a",
					"b",
					new Map([
						["e:source", { side, offset }],
						["e:target", { side: targetSide, offset: 0 }],
					]),
				),
				route(
					"b",
					"a",
					new Map([
						["e:target", { side, offset }],
						["e:source", { side: targetSide, offset: 0 }],
					]),
				),
			]) {
				const [line] = scene.elements.flatMap((element) =>
					element.type === "arrow" ? [element] : [],
				);
				expect(line?.curved).toBe(true);
				// Square lines run only horizontally or vertically; a curved corner does not.
				expect(
					line!.points.some(
						(point, index) =>
							index > 0 &&
							Math.abs(point.x - line!.points[index - 1]!.x) > 0.01 &&
							Math.abs(point.y - line!.points[index - 1]!.y) > 0.01,
					),
				).toBe(true);
				expect(strays(scene)).toEqual([]);
			}
		},
	);

	it("keeps a line out of zones neither end sits in and inside those both do", () => {
		const scene = renderIntermediateDiagram({
			...zoneStressFixtures["depth-four"],
			layout: { direction: "TB", edgeRouting: "curved" },
		});
		expect(strays(scene)).toEqual([]);
	});

	it.each(["TB", "BT", "LR", "RL"] as const)(
		"curves every group and zone fixture %s without straying",
		(direction) => {
			const fixtures = { ...groupFixtures, ...zoneFixtures, ...zoneStressFixtures };
			expect(
				Object.entries(fixtures).flatMap(([name, fixture]) =>
					strays(
						renderIntermediateDiagram({
							...fixture,
							layout: { direction, edgeRouting: "curved" },
						}),
					).map((stray) => `${name}: ${stray}`),
				),
			).toEqual([]);
		},
		120_000,
	);
});
