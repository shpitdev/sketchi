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

describe.each(["TB", "BT", "LR", "RL"] as const)("settled direct feedback: %s", (direction) => {
	it.each(["straight", "curved"] as const)("reserves every final %s endpoint", (edgeRouting) => {
		for (const minimal of [false, true]) {
			const workflow = routingFixtures["shared-feedback-returns"];
			const fixture = {
				...workflow,
				nodes: minimal ? workflow.nodes.filter((n) => n.kind === "process") : workflow.nodes,
				edges: workflow.edges
					.filter((e) => !minimal || (e.id !== "entry" && e.id !== "release"))
					.map(({ label: _label, ...edge }) => edge),
				layout: { direction, edgeRouting },
			};
			const scene = renderIntermediateDiagram(fixture);
			const arrows = scene.elements.filter((e) => e.type === "arrow");
			expect(scene.elements.filter((e) => e.type === "node")).toHaveLength(minimal ? 4 : 6);
			expect(arrows).toHaveLength(minimal ? 6 : 8);
			const endpoints = arrows.flatMap((a) => [
				{ node: a.sourceNodeId, point: a.points[0], id: `${a.edgeId}:source` },
				{ node: a.targetNodeId, point: a.points.at(-1)!, id: `${a.edgeId}:target` },
			]);
			for (const [i, a] of endpoints.entries())
				for (const b of endpoints.slice(i + 1))
					if (a.node === b.node)
						expect(
							Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y),
							`${a.id}/${b.id}`,
						).toBeGreaterThan(0.01);
		}
	});
	it.each(["straight", "curved"] as const)(
		"keeps the exported-size own label clear of %s feedback",
		(edgeRouting) => {
			for (const minimal of [false, true]) {
				const workflow = routingFixtures["shared-feedback-returns"];
				const scene = renderIntermediateDiagram({
					...workflow,
					nodes: minimal ? workflow.nodes.filter((n) => n.kind === "process") : workflow.nodes,
					edges: workflow.edges
						.filter(
							(e) =>
								e.id !== "ba" &&
								e.id !== "da" &&
								(!minimal || (e.id !== "entry" && e.id !== "release")),
						)
						.map((e) => (e.id === "ca" ? { ...e, label: "Revisit earlier stage now" } : e)),
					layout: { direction, edgeRouting },
				});
				const arrow = scene.elements.find((e) => e.type === "arrow" && e.edgeId === "ca")!;
				const label = scene.elements.find((e) => e.type === "text" && e.id === "edge:ca:label")!;
				if (arrow.type !== "arrow" || label.type !== "text")
					throw new Error("Missing labeled return");
				const text = wrapTextToWidth(label.text, label.maxWidth ?? 160, label.fontSize),
					width = boundLabelWidth(text, label.fontSize, label.maxWidth ?? 160),
					height = Math.ceil(text.split("\n").length * label.fontSize * 1.35);
				for (const [i, start] of arrow.points.slice(0, -1).entries()) {
					const end = arrow.points[i + 1]!;
					for (let step = 1; step < 1000; step++) {
						const x = start.x + ((end.x - start.x) * step) / 1000,
							y = start.y + ((end.y - start.y) * step) / 1000;
						expect(
							x > label.x - width / 2 + 0.01 &&
								x < label.x + width / 2 - 0.01 &&
								y > label.y - height / 2 + 0.01 &&
								y < label.y + height / 2 - 0.01,
						).toBe(false);
					}
				}
			}
		},
	);
});

describe.each(["TB", "BT", "LR", "RL"] as const)("direct return corridors: %s", (direction) => {
	it.each(["straight", "curved"] as const)(
		"keeps both %s returns distinct with mixed or absent labels",
		(edgeRouting) => {
			for (const labeled of [false, true]) {
				const fixture = routingFixtures["two-stage-retry"];
				const scene = renderIntermediateDiagram({
					...fixture,
					edges: fixture.edges.map((e) =>
						e.id === "e5" && labeled ? { ...e, label: "Retry" } : e,
					),
					layout: { direction, edgeRouting },
				});
				const arrows = scene.elements.filter((e) => e.type === "arrow");
				const nodes = scene.elements.filter((e) => e.type === "node");
				expect(nodes).toHaveLength(6);
				expect(arrows).toHaveLength(7);
				const returns = arrows.filter((e) => e.edgeId === "e5" || e.edgeId === "e6");
				expect(new Set(returns.map((a) => JSON.stringify(a.points[0]))).size).toBe(2);
				for (const [i, a] of arrows.entries()) {
					for (const b of arrows.slice(i + 1))
						for (const x of segmentsFromPoints(a.points))
							for (const y of segmentsFromPoints(b.points))
								expect(segmentsOverlapInterior(x, y), `${a.edgeId}/${b.edgeId}`).toBe(false);
					const [start, end] = a.points;
					for (let step = 1; step < 100; step++) {
						const x = start.x + ((end!.x - start.x) * step) / 100,
							y = start.y + ((end!.y - start.y) * step) / 100;
						for (const n of nodes)
							expect(
								x > n.x + 0.01 &&
									x < n.x + n.width - 0.01 &&
									y > n.y + 0.01 &&
									y < n.y + n.height - 0.01,
								`${a.edgeId}/${n.nodeId}`,
							).toBe(false);
					}
				}
			}
		},
	);
});

describe.each(["TB", "BT", "LR", "RL"] as const)("feedback capacity: %s", (direction) => {
	it("keeps all four mixed-label returns at distinct ports", () => {
		const fixture = routingFixtures["multi-stage-rework"];
		const scene = renderIntermediateDiagram({
			...fixture,
			layout: { ...fixture.layout, direction },
		});
		const arrows = scene.elements.filter((e) => e.type === "arrow");
		const returns = arrows.filter((a) => a.edgeId.startsWith("back"));
		expect(scene.elements.filter((e) => e.type === "node")).toHaveLength(7);
		expect(arrows).toHaveLength(10);
		expect(returns).toHaveLength(4);
		expect(new Set(returns.map((a) => JSON.stringify(a.points[0]))).size).toBe(4);
		for (const [i, a] of returns.entries())
			for (const b of returns.slice(i + 1)) {
				expect(
					Math.hypot(a.points[0].x - b.points[0].x, a.points[0].y - b.points[0].y),
				).toBeGreaterThanOrEqual(18);
				for (const x of segmentsFromPoints(a.points))
					for (const y of segmentsFromPoints(b.points))
						expect(segmentsOverlapInterior(x, y)).toBe(false);
			}
	});
	it.each(["straight", "curved"] as const)("keeps %s retry clear of every stage", (edgeRouting) => {
		const workflow = routingFixtures["feedback-chain"];
		for (const minimal of [false, true]) {
			const fixture = minimal
				? {
						...workflow,
						nodes: workflow.nodes.filter((n) => n.kind === "process"),
						edges: workflow.edges.filter((e) => e.id !== "start" && e.id !== "end"),
					}
				: workflow;
			const scene = renderIntermediateDiagram({ ...fixture, layout: { direction, edgeRouting } });
			const nodes = scene.elements.filter((e) => e.type === "node");
			const arrows = scene.elements.filter((e) => e.type === "arrow");
			expect(nodes).toHaveLength(minimal ? 3 : 5);
			expect(arrows).toHaveLength(minimal ? 3 : 5);
			const [start, end] = arrows.find((e) => e.edgeId === "ca")!.points;
			for (let i = 1; i < 100; i++) {
				const x = start.x + ((end!.x - start.x) * i) / 100;
				const y = start.y + ((end!.y - start.y) * i) / 100;
				for (const n of nodes)
					expect(x > n.x && x < n.x + n.width && y > n.y && y < n.y + n.height, n.nodeId).toBe(
						false,
					);
			}
		}
	});
});

describe.each(["TB", "BT", "LR", "RL"] as const)("direct feedback: %s", (direction) => {
	it.each(["straight", "curved"] as const)(
		"keeps %s feedback outside both bound nodes",
		(edgeRouting) => {
			const fixture = routingFixtures["review-feedback"];
			const scene = renderIntermediateDiagram({ ...fixture, layout: { direction, edgeRouting } });
			const feedback = scene.elements.find((e) => e.type === "arrow" && e.edgeId === "feedback")!;
			if (feedback.type !== "arrow") throw new Error("Missing feedback arrow");
			const source = scene.elements.find(
				(e) => e.type === "node" && e.nodeId === feedback.sourceNodeId,
			)!;
			const target = scene.elements.find(
				(e) => e.type === "node" && e.nodeId === feedback.targetNodeId,
			)!;
			if (source.type !== "node" || target.type !== "node") throw new Error("Missing bound nodes");
			const start = feedback.points[0],
				end = feedback.points.at(-1)!;
			function leavesNode(node: NodeSceneElement, p: ScenePoint, q: ScenePoint) {
				switch (side(node, p)) {
					case "left":
						return q.x < p.x;
					case "right":
						return q.x > p.x;
					case "top":
						return q.y < p.y;
					case "bottom":
						return q.y > p.y;
				}
			}
			expect(leavesNode(source, start, end)).toBe(true);
			expect(leavesNode(target, end, start)).toBe(true);
		},
	);
});

it.each(["straight", "curved"] as const)(
	"keeps %s feedback clear of the existing No label",
	(edgeRouting) => {
		const scene = renderIntermediateDiagram({
			...routingFixtures["review-feedback"],
			layout: { direction: "TB", edgeRouting },
		});
		const feedback = scene.elements.find((e) => e.type === "arrow" && e.edgeId === "feedback")!;
		const label = scene.elements.find((e) => e.type === "text" && e.id === "edge:no:label")!;
		if (feedback.type !== "arrow" || label.type !== "text")
			throw new Error("Missing feedback or label");
		const width = boundLabelWidth(
			wrapTextToWidth(label.text, label.maxWidth ?? 160, label.fontSize),
			label.fontSize,
			label.maxWidth ?? 160,
		);
		const [start, end] = feedback.points;
		for (let i = 1; i < 100; i++) {
			const x = start.x + ((end!.x - start.x) * i) / 100;
			const y = start.y + ((end!.y - start.y) * i) / 100;
			expect(
				x > label.x - width / 2 && x < label.x + width / 2 && y > label.y - 9 && y < label.y + 9,
			).toBe(false);
		}
	},
);
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
	it("has no coincident interiors between directed routes", () => {
		const failures: string[] = [];
		for (const [i, a] of arrows.entries())
			for (const b of arrows.slice(i + 1))
				for (const x of segmentsFromPoints(a.points))
					for (const y of segmentsFromPoints(b.points))
						if (segmentsOverlapInterior(x, y)) failures.push(`${a.edgeId}/${b.edgeId}`);
		expect(failures).toEqual([]);
	});

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

describe.each(["TB", "BT", "LR", "RL"] as const)("feedback ports: %s", (direction) => {
	it.each(["review-feedback", "wait-retry", "decision-feedback"] as const)(
		"separates the %s return from forward departures and arrivals",
		(name) => {
			const fixture = routingFixtures[name];
			const scene = renderIntermediateDiagram({
				...fixture,
				layout: { ...fixture.layout, direction },
			});
			const nodes = scene.elements.filter((e) => e.type === "node");
			const arrows = scene.elements.filter((e) => e.type === "arrow");
			const feedback = arrows.find((a) => a.edgeId === "feedback")!;
			const target = nodes.find((n) => n.nodeId === feedback.targetNodeId)!;
			const source = nodes.find((n) => n.nodeId === feedback.sourceNodeId)!;
			const forward = arrows.filter((a) => a !== feedback);
			const overlaps = arrows.flatMap((a, i) =>
				arrows
					.slice(i + 1)
					.filter((b) =>
						segmentsFromPoints(a.points).some((x) =>
							segmentsFromPoints(b.points).some((y) => segmentsOverlapInterior(x, y)),
						),
					)
					.map((b) => `${a.edgeId}/${b.edgeId}`),
			);
			expect(overlaps).toEqual([]);
			expect(
				forward
					.filter((a) => a.sourceNodeId === target.nodeId)
					.map((a) => side(target, a.points[0])),
			).not.toContain(side(target, feedback.points.at(-1)!));
			expect(
				forward
					.filter((a) => a.targetNodeId === source.nodeId)
					.map((a) => side(source, a.points.at(-1)!)),
			).not.toContain(side(source, feedback.points[0]));
			expect(
				forward
					.filter((a) => a.targetNodeId === target.nodeId)
					.map((a) => side(target, a.points.at(-1)!)),
			).not.toContain(side(target, feedback.points.at(-1)!));
		},
	);
});
