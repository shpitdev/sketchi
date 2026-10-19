import { describe, expect, it } from "vitest";

import {
	estimateTextWidth,
	type IntermediateDiagram,
	segmentsFromPoints,
	segmentsOverlapInterior,
	SKETCHI_DIAGRAM_STYLE,
} from "@sketchi/diagram-core";

import { type GraphAnchor, renderGraphDiagram, type RenderedDiagramScene } from "./scene.js";

/**
 * Three boxes a family placed itself: one on the left whose middle row feeds
 * two on the right, and a lower one beneath them.
 */
function placedGraph(labels = false): IntermediateDiagram {
	return {
		id: "placed",
		title: "Placed",
		type: "flowchart",
		nodes: ["left", "upper", "lower"].map((id) => ({
			id,
			label: id,
			kind: "entity",
			metadata: {},
		})),
		edges: [
			{
				id: "a",
				source: "left",
				target: "upper",
				metadata: {},
				...(labels ? { label: "feeds" } : {}),
			},
			{ id: "b", source: "left", target: "lower", metadata: {} },
		],
		layout: { direction: "LR", edgeRouting: "orthogonal" },
		style: SKETCHI_DIAGRAM_STYLE,
		metadata: {},
	};
}

const placement = new Map([
	["left", { x: 0, y: 100, width: 200, height: 160 }],
	["upper", { x: 400, y: 0, width: 200, height: 160 }],
	["lower", { x: 400, y: 260, width: 200, height: 160 }],
]);

/** Both lines leave the left box's right side at its middle row, each reaching a row of its own. */
const anchors = new Map<string, GraphAnchor>([
	["a:source", { side: "right", offset: 10 }],
	["b:source", { side: "right", offset: 10 }],
	["a:target", { side: "left", offset: -30 }],
	["b:target", { side: "left", offset: 40 }],
]);

const arrows = (scene: RenderedDiagramScene) =>
	scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : []));
const boxes = (scene: RenderedDiagramScene) =>
	new Map(
		scene.elements.flatMap((element) =>
			element.type === "node" ? [[element.nodeId, element] as const] : [],
		),
	);

describe("placed graphs", () => {
	it("draws each node at the box its family placed it in, keeping relative positions", () => {
		const scene = renderGraphDiagram(placedGraph(), { placement, anchors });
		const drawn = boxes(scene);
		const left = drawn.get("left")!;
		for (const [id, box] of placement) {
			expect(drawn.get(id)).toMatchObject({ width: box.width, height: box.height });
			expect(drawn.get(id)!.x - left.x).toBe(box.x - placement.get("left")!.x);
			expect(drawn.get(id)!.y - left.y).toBe(box.y - placement.get("left")!.y);
		}
	});

	it("pins each anchored end to its side and offset, and keeps only a pinned line's corners", () => {
		const scene = renderGraphDiagram(placedGraph(), { placement, anchors });
		const drawn = boxes(scene);
		const [left, upper, lower] = ["left", "upper", "lower"].map((id) => drawn.get(id)!);
		for (const arrow of arrows(scene)) {
			const target = arrow.edgeId === "a" ? upper! : lower!;
			const offset = arrow.edgeId === "a" ? -30 : 40;
			expect(arrow.points[0]).toEqual({
				x: left!.x + left!.width,
				y: left!.y + left!.height / 2 + 10,
			});
			expect(arrow.points.at(-1)).toEqual({
				x: target.x,
				y: target.y + target.height / 2 + offset,
			});
			// No point continues a straight run.
			for (const [index, point] of arrow.points.slice(1, -1).entries()) {
				const [before, after] = [arrow.points[index]!, arrow.points[index + 2]!];
				expect(
					(before.x === point.x && point.x === after.x) ||
						(before.y === point.y && point.y === after.y),
				).toBe(false);
			}
		}
	});

	it("lets ends pinned to one point share their stem and nothing more", () => {
		const scene = renderGraphDiagram(placedGraph(), { placement, anchors });
		const [a, b] = arrows(scene).map((arrow) => segmentsFromPoints(arrow.points));
		const overlaps = a!.flatMap((left) =>
			b!.filter((right) => segmentsOverlapInterior(left, right)).map((right) => [left, right]),
		);
		// Only the two first runs, out of the shared port, may coincide.
		expect(overlaps.length).toBeGreaterThan(0);
		for (const [left, right] of overlaps) {
			expect(left!.isFirstSegment).toBe(true);
			expect(right!.isFirstSegment).toBe(true);
		}
	});

	it("turns lines that share a port at their own runs, so no two share a vertical line", () => {
		const staggered = new Map<string, GraphAnchor>([
			...anchors,
			["a:source", { side: "right", offset: 10, run: 48 }],
			["b:source", { side: "right", offset: 10, run: 80 }],
		]);
		const scene = renderGraphDiagram(placedGraph(), { placement, anchors: staggered });
		const left = boxes(scene).get("left")!;
		const [a, b] = ["a", "b"].map((id) => arrows(scene).find((arrow) => arrow.edgeId === id)!);
		// Each first run ends where its line turns: 48 and 80 out from the shared port.
		expect(a!.points[1]!.x - left.x - left.width).toBe(48);
		expect(b!.points[1]!.x - left.x - left.width).toBe(80);
	});

	it("keeps every line straight for its end run at each end, its label past the run", () => {
		const scene = renderGraphDiagram(placedGraph(true), { placement, anchors, endRun: 48 });
		for (const arrow of arrows(scene)) {
			const runs = segmentsFromPoints(arrow.points);
			expect(runs[0]!.max - runs[0]!.min, arrow.id).toBeGreaterThanOrEqual(48);
			expect(runs.at(-1)!.max - runs.at(-1)!.min, arrow.id).toBeGreaterThanOrEqual(48);
		}
		const left = boxes(scene).get("left")!;
		const label = scene.elements.find((element) => element.id === "edge:a:label");
		expect(label?.type).toBe("text");
		if (label?.type !== "text") return;
		// The label starts past the end run from the left box's side.
		expect(label.x - estimateTextWidth("feeds", 13) / 2).toBeGreaterThanOrEqual(
			left.x + left.width + 48,
		);
	});

	it("routes a pinned line between nodes instead of around everything", () => {
		// The direct row between left and far is blocked by middle; the gap above it is open.
		const graph = {
			...placedGraph(),
			nodes: ["left", "middle", "far"].map((id) => ({
				id,
				label: id,
				kind: "entity",
				metadata: {},
			})),
			edges: [{ id: "long", source: "left", target: "far", metadata: {} }],
		} as IntermediateDiagram;
		const scene = renderGraphDiagram(graph, {
			placement: new Map([
				["left", { x: 0, y: 0, width: 200, height: 120 }],
				["middle", { x: 400, y: 0, width: 200, height: 400 }],
				["far", { x: 800, y: 0, width: 200, height: 120 }],
			]),
			anchors: new Map<string, GraphAnchor>([
				["long:source", { side: "right", offset: 0 }],
				["long:target", { side: "left", offset: 0 }],
			]),
			endRun: 48,
		});
		const [line] = arrows(scene);
		const middle = boxes(scene).get("middle")!;
		for (const segment of segmentsFromPoints(line!.points))
			expect(
				segment.orientation === "horizontal" &&
					segment.staticCoordinate > middle.y &&
					segment.staticCoordinate < middle.y + middle.height &&
					segment.min < middle.x + middle.width &&
					segment.max > middle.x,
			).toBe(false);
	});
});
