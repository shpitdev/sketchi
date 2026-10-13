import { describe, expect, it } from "vitest";
import {
	flowchartFixture,
	pharmaBatchDispositionFlowchart,
	routingFixtures,
	segmentsFromPoints,
	segmentCrossesBoundsInterior,
	segmentsOverlapInterior,
	boundLabelWidth,
	wrapTextToWidth,
	parseIntermediateDiagram,
} from "@sketchi/diagram-core";
import { renderIntermediateDiagram, type NodeSceneElement, type ScenePoint } from "./scene";

// Infer the port side independently from the router, including curved boundaries.
function side(node: NodeSceneElement, p: ScenePoint) {
	const x = (p.x - node.x - node.width / 2) / (node.width / 2),
		y = (p.y - node.y - node.height / 2) / (node.height / 2);
	return Math.abs(x) > Math.abs(y) ? (x < 0 ? "left" : "right") : y < 0 ? "top" : "bottom";
}
function outward(node: NodeSceneElement, p: ScenePoint, q: ScenePoint) {
	switch (side(node, p)) {
		case "left":
			return p.y === q.y && p.x - q.x >= 36;
		case "right":
			return p.y === q.y && q.x - p.x >= 36;
		case "top":
			return p.x === q.x && p.y - q.y >= 36;
		case "bottom":
			return p.x === q.x && q.y - p.y >= 36;
	}
}
const fourBranches = parseIntermediateDiagram({
	...flowchartFixture,
	nodes: [
		{ id: "decision", label: "Choose path", kind: "decision" },
		...["a", "b", "c", "d"].map((id) => ({ id, label: id })),
	],
	edges: ["d", "b", "a", "c"].map((id) => ({ id, source: "decision", target: id, label: id })),
});
const manyInputs = parseIntermediateDiagram({
	...flowchartFixture,
	nodes: [
		...[...Array(12).keys()].map((i) => ({ id: `source-${i}`, label: `Input ${i}` })),
		{ id: "sink", label: "Collect inputs" },
	],
	edges: [...Array(12).keys()].map((i) => ({
		id: `input-${i}`,
		source: `source-${i}`,
		target: "sink",
	})),
});
const fixtures = {
	...routingFixtures,
	flowchartFixture,
	pharmaBatchDispositionFlowchart,
	fourBranches,
	manyInputs,
};
describe.each(Object.entries(fixtures))("%s", (_name, fixture) => {
	const scene = renderIntermediateDiagram(fixture);
	const nodes = scene.elements.filter((e) => e.type === "node");
	const arrows = scene.elements.filter((e) => e.type === "arrow");

	it("avoids all node interiors except the perpendicular endpoint stubs", () => {
		const failures: string[] = [];
		for (const a of arrows)
			for (const [i, s] of segmentsFromPoints(a.points).entries())
				for (const n of nodes) {
					if (
						(i === 0 && n.nodeId === a.sourceNodeId) ||
						(i === a.points.length - 2 && n.nodeId === a.targetNodeId)
					)
						continue;
					if (segmentCrossesBoundsInterior(s, n))
						failures.push(`${a.edgeId}:${i} through ${n.nodeId}`);
				}
		expect(failures).toEqual([]);
	});
	it("has outward perpendicular stubs at both ports", () => {
		const failures = arrows
			.filter(
				(a) =>
					!outward(
						nodes.find((n) => n.nodeId === a.sourceNodeId)!,
						a.points[0],
						a.points[1]!,
					) ||
					!outward(
						nodes.find((n) => n.nodeId === a.targetNodeId)!,
						a.points.at(-1)!,
						a.points.at(-2)!,
					),
			)
			.map((a) => a.edgeId);
		expect(failures).toEqual([]);
	});
	it("separates target endpoints and final approaches", () => {
		for (const [i, a] of arrows.entries())
			for (const b of arrows.slice(i + 1))
				if (a.targetNodeId === b.targetNodeId) {
					const p = a.points.at(-1)!,
						q = b.points.at(-1)!;
					expect(
						Math.hypot(p.x - q.x, p.y - q.y),
						`${a.edgeId}/${b.edgeId}`,
					).toBeGreaterThanOrEqual(18 - 0.001);
					expect(
						segmentsOverlapInterior(
							segmentsFromPoints(a.points).at(-1)!,
							segmentsFromPoints(b.points).at(-1)!,
						),
					).toBe(false);
				}
	});
	it("uses distinct decision sides when at most three branches leave", () => {
		for (const n of nodes.filter((n) => n.kind === "decision")) {
			const outgoing = arrows.filter((a) => a.sourceNodeId === n.nodeId);
			if (outgoing.length <= 3) {
				expect(new Set(outgoing.map((a) => side(n, a.points[0]))).size, n.nodeId).toBe(
					outgoing.length,
				);
			}
		}
	});
	it("keeps shared-side decision branches from crossing", () => {
		for (const [i, a] of arrows.entries())
			for (const b of arrows.slice(i + 1)) {
				const node = nodes.find((n) => n.nodeId === a.sourceNodeId)!;
				if (
					node.kind !== "decision" ||
					a.sourceNodeId !== b.sourceNodeId ||
					side(node, a.points[0]) !== side(node, b.points[0])
				)
					continue;
				for (const x of segmentsFromPoints(a.points))
					for (const y of segmentsFromPoints(b.points)) {
						expect(segmentsOverlapInterior(x, y)).toBe(false);
						if (x.orientation !== y.orientation)
							expect(
								x.staticCoordinate > y.min &&
									x.staticCoordinate < y.max &&
									y.staticCoordinate > x.min &&
									y.staticCoordinate < x.max,
							).toBe(false);
					}
			}
	});

	it("places branch labels on their first outward stub, clear of nodes and other arrows", () => {
		const failures: string[] = [];
		for (const a of arrows) {
			const edge = fixture.edges.find((e) => e.id === a.edgeId);
			if (!edge?.label) continue;
			const label = scene.elements.find((e) => e.type === "text" && e.id === `${a.id}:label`);
			if (!label || label.type !== "text") {
				failures.push(`${a.edgeId}:missing positioned label`);
				continue;
			}
			const text = wrapTextToWidth(label.text, label.maxWidth ?? 160, label.fontSize);
			const width = boundLabelWidth(text, label.fontSize, label.maxWidth ?? 160);
			const box = { x: label.x - width / 2, y: label.y - 9, width, height: 18 };
			const p = a.points[0],
				q = a.points[1]!;
			const cx = box.x + box.width / 2,
				cy = box.y + box.height / 2;
			if (
				p.y === q.y
					? Math.abs(cy - p.y) > box.height / 2 + 6 ||
						cx < Math.min(p.x, q.x) ||
						cx > Math.max(p.x, q.x)
					: Math.abs(cx - p.x) > box.width / 2 + 12 ||
						cy < Math.min(p.y, q.y) ||
						cy > Math.max(p.y, q.y)
			)
				failures.push(`${a.edgeId}:not on stub`);
			for (const b of arrows.filter((b) => b !== a))
				if (segmentsFromPoints(b.points).some((s) => segmentCrossesBoundsInterior(s, box)))
					failures.push(`${a.edgeId}:label hits ${b.edgeId}`);
			for (const n of nodes)
				if (
					box.x < n.x + n.width &&
					box.x + box.width > n.x &&
					box.y < n.y + n.height &&
					box.y + box.height > n.y
				)
					failures.push(`${a.edgeId}:label hits ${n.nodeId}`);
		}
		expect(failures).toEqual([]);
	});
});
