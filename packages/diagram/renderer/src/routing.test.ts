import { describe, expect, it } from "vitest";
import {
	flowchartFixture,
	pharmaBatchDispositionFlowchart,
	rankGapFlowchart,
	routingFixtures,
	segmentsFromPoints,
	segmentCrossesBoundsInterior,
	segmentsOverlapInterior,
	wrappedLabelWidth,
	wrapTextToWidth,
	parseFlowchartDiagram,
	parseIntermediateDiagram,
	candidateRouteQuality,
	routingJogReach,
	routingQualityFindings,
	routingQualityScale,
	routingWideBend,
} from "@sketchi/diagram-core";
import { renderIntermediateDiagram, type NodeSceneElement, type ScenePoint } from "./scene";

/** The stored, wrapped box of a free edge label, as the Excalidraw adapter writes it. */
function renderedLabelBox(label: {
	text: string;
	fontSize: number;
	maxWidth?: number;
	x: number;
	y: number;
}) {
	const text = wrapTextToWidth(label.text, label.maxWidth ?? 160, label.fontSize);
	const width = wrappedLabelWidth(text, label.fontSize, label.maxWidth ?? 160);
	const height = Math.ceil(text.split("\n").length * label.fontSize * 1.35);
	return { x: label.x - width / 2, y: label.y - height / 2, width, height };
}

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
				const box = renderedLabelBox(label);
				for (const [i, start] of arrow.points.slice(0, -1).entries()) {
					const end = arrow.points[i + 1]!;
					for (let step = 1; step < 1000; step++) {
						const x = start.x + ((end.x - start.x) * step) / 1000,
							y = start.y + ((end.y - start.y) * step) / 1000;
						expect(
							x > box.x + 0.01 &&
								x < box.x + box.width - 0.01 &&
								y > box.y + 0.01 &&
								y < box.y + box.height - 0.01,
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
		const box = renderedLabelBox(label);
		const [start, end] = feedback.points;
		for (let i = 1; i < 100; i++) {
			const x = start.x + ((end!.x - start.x) * i) / 100;
			const y = start.y + ((end!.y - start.y) * i) / 100;
			expect(x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height).toBe(false);
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

	it("places branch labels beside their own route, clear of nodes and every arrow", () => {
		const failures: string[] = [];
		for (const a of arrows) {
			const edge = fixture.edges.find((e) => e.id === a.edgeId);
			if (!edge?.label) continue;
			const label = scene.elements.find((e) => e.type === "text" && e.id === `${a.id}:label`);
			if (!label || label.type !== "text") {
				failures.push(`${a.edgeId}:missing positioned label`);
				continue;
			}
			const box = renderedLabelBox(label);
			const cx = box.x + box.width / 2,
				cy = box.y + box.height / 2;
			// Beside one of its own runs, as a stub label sits beside its stub.
			const beside = a.points.slice(1).some((q, i) => {
				const p = a.points[i]!;
				return p.y === q.y
					? Math.abs(cy - p.y) <= box.height / 2 + 6 &&
							cx >= Math.min(p.x, q.x) &&
							cx <= Math.max(p.x, q.x)
					: p.x === q.x &&
							Math.abs(cx - p.x) <= box.width / 2 + 12 &&
							cy >= Math.min(p.y, q.y) &&
							cy <= Math.max(p.y, q.y);
			});
			if (!beside) failures.push(`${a.edgeId}:not beside its route`);
			for (const b of arrows)
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

/**
 * Endpoint jogs, near-coincident corridors, touching arrowheads and lines through
 * another arrow's head, judged at reader scale.
 */
function readerFindings(scene: ReturnType<typeof renderIntermediateDiagram>): string[] {
	const nodes = scene.elements.filter((e) => e.type === "node");
	const arrows = scene.elements.filter((e) => e.type === "arrow");
	const xs = [
		...nodes.flatMap((n) => [n.x, n.x + n.width]),
		...arrows.flatMap((a) => a.points.map((p) => p.x)),
	];
	const ys = [
		...nodes.flatMap((n) => [n.y, n.y + n.height]),
		...arrows.flatMap((a) => a.points.map((p) => p.y)),
	];
	const scale = routingQualityScale({
		width: Math.max(...xs) - Math.min(...xs),
		height: Math.max(...ys) - Math.min(...ys),
	});
	const routes = arrows.map((a) => ({
		id: a.edgeId,
		points: a.points,
		sourceId: a.sourceNodeId,
		targetId: a.targetNodeId,
	}));
	const score = candidateRouteQuality(routes, scale);
	return [
		...routingQualityFindings(routes, scale).map((finding) => finding.message),
		...routes
			.filter((route) => score(route).arrowheadsCrossed > 0)
			.map((route) => `${route.id} passes through another arrowhead`),
	];
}

const directions = ["TB", "BT", "LR", "RL"] as const;
// Rendering is deterministic, so each fixture and direction renders once for every check.
const rendered = new Map<string, ReturnType<typeof renderIntermediateDiagram>>();
const render = (
	fixture: (typeof routingFixtures)[keyof typeof routingFixtures],
	direction: string,
) => {
	const key = `${fixture.id}:${direction}`;
	if (!rendered.has(key))
		rendered.set(
			key,
			renderIntermediateDiagram({ ...fixture, layout: { ...fixture.layout, direction } }),
		);
	return rendered.get(key)!;
};

describe("reader-scale routing polish", () => {
	it.each(Object.keys(routingFixtures))(
		"keeps %s free of jogs, near-coincident corridors and touching arrowheads",
		(name) => {
			expect(
				readerFindings(render(routingFixtures[name as keyof typeof routingFixtures], "TB")),
			).toEqual([]);
		},
	);

	describe.each(directions)("%s", (direction) => {
		it.each([
			"release-fan-in",
			"stability-fan-in",
			"renewal-retry",
			"cancellation-convergence",
		] as const)("keeps %s polished in every direction", (name) => {
			expect(readerFindings(render(routingFixtures[name], direction))).toEqual([]);
		});

		// Known residuals in mirrored layouts; a count may only fall.
		const residuals: Partial<Record<string, Partial<Record<(typeof directions)[number], number>>>> =
			{
				"data-import-validation": { BT: 1, RL: 1 },
				"feedback-skip-stubs": { LR: 1, RL: 1 },
				"invoice-approval": { BT: 2 },
				"pharma-batch-disposition": { LR: 1, RL: 1 },
				"warehouse-reorder": { RL: 1 },
			};
		it.each(Object.keys(routingFixtures))("does not add reader-scale defects to %s", (name) => {
			expect(
				readerFindings(render(routingFixtures[name as keyof typeof routingFixtures], direction))
					.length,
			).toBeLessThanOrEqual(residuals[name]?.[direction] ?? 0);
		});

		it("keeps a centered straight spine and lands the loop clear of it", () => {
			for (const [name, spine, loop] of [
				["stability-fan-in", "classify", "retry"],
				["renewal-retry", "bill", "retry"],
			] as const) {
				const scene = render(routingFixtures[name], direction);
				const arrows = scene.elements.filter((e) => e.type === "arrow");
				const nodes = scene.elements.filter((e) => e.type === "node");
				const straight = arrows.find((a) => a.edgeId === spine)!;
				const returning = arrows.find((a) => a.edgeId === loop)!;
				const target = nodes.find((n) => n.nodeId === straight.targetNodeId)!;
				const end = straight.points.at(-1)!;
				expect(straight.points, `${name}:${spine}`).toHaveLength(2);
				expect(
					direction === "TB" || direction === "BT"
						? end.x - (target.x + target.width / 2)
						: end.y - (target.y + target.height / 2),
					`${name}:${spine} centered`,
				).toBeCloseTo(0, 6);
				const arrival = returning.points.at(-1)!;
				expect(
					side(target, arrival) !== side(target, end) ||
						Math.hypot(arrival.x - end.x, arrival.y - end.y) >= 36 - 0.001,
					`${name}:${loop} clear of ${spine}`,
				).toBe(true);
			}
		});

		it("separates every arrival at three-way, two-way and convergent fan-ins", () => {
			for (const [name, target, count] of [
				["stability-fan-in", "stable", 3],
				["release-fan-in", "release", 2],
				["cancellation-convergence", "confirm", 2],
			] as const) {
				const scene = render(routingFixtures[name], direction);
				const arrivals = scene.elements
					.filter((e) => e.type === "arrow" && e.targetNodeId === target)
					.map((a) => (a.type === "arrow" ? a.points.at(-1)! : { x: 0, y: 0 }));
				expect(arrivals).toHaveLength(count);
				for (const [i, p] of arrivals.entries())
					for (const q of arrivals.slice(i + 1))
						expect(Math.hypot(p.x - q.x, p.y - q.y), name).toBeGreaterThanOrEqual(36 - 0.001);
			}
		});
	});
});

describe.each(["LR", "RL", "TB", "BT"] as const)("direct decision ports: %s", (direction) => {
	it.each(["straight", "curved"] as const)(
		"leaves and enters every %s node outward instead of cutting back through it",
		(edgeRouting) => {
			// Review repro: mirrored decision vertices sent a direct branch back through its diamond.
			const scene = renderIntermediateDiagram(
				parseFlowchartDiagram({
					id: "retry-decisions",
					title: "Retry decisions",
					type: "flowchart",
					nodes: [
						{ id: "n0", label: "Stage 0", kind: "start" },
						{ id: "n1", label: "Escalate to on-call engineer 1", kind: "decision" },
						{ id: "n2", label: "Stage 2", kind: "end" },
						{ id: "n3", label: "Approve 3", kind: "decision" },
						{ id: "n4", label: "Stage 4", kind: "end" },
					],
					edges: [
						{ id: "e0", source: "n0", target: "n1" },
						{ id: "e1", source: "n1", target: "n2", label: "No" },
						{ id: "e2", source: "n1", target: "n3", label: "Retry" },
						{ id: "e3", source: "n3", target: "n4", label: "Yes" },
						{ id: "e4", source: "n3", target: "n1", label: "No" },
					],
					layout: { direction, edgeRouting },
				}),
			);
			const nodes = scene.elements.filter((e) => e.type === "node");
			const inward: string[] = [];
			for (const arrow of scene.elements.filter((e) => e.type === "arrow"))
				for (const [nodeId, point, next] of [
					[arrow.sourceNodeId, arrow.points[0], arrow.points[1]!],
					[arrow.targetNodeId, arrow.points.at(-1)!, arrow.points.at(-2)!],
				] as const) {
					const node = nodes.find((n) => n.nodeId === nodeId)!;
					const x =
						(point.x + (next.x - point.x) * 1e-4 - node.x - node.width / 2) / (node.width / 2);
					const y =
						(point.y + (next.y - point.y) * 1e-4 - node.y - node.height / 2) / (node.height / 2);
					const extent =
						node.shape === "diamond"
							? Math.abs(x) + Math.abs(y)
							: node.shape === "ellipse"
								? Math.hypot(x, y)
								: Math.max(Math.abs(x), Math.abs(y));
					if (extent < 1 - 1e-6) inward.push(`${arrow.edgeId}:${nodeId}`);
				}
			expect(inward).toEqual([]);
		},
	);
});

describe("rank gaps", () => {
	it("grows the gap a line steps sideways across until the step clears both its ends", () => {
		// Monitoring led to the resolution through a 96-unit gap with a 148-unit
		// step: wherever the step sat, it read as a jog into the arrowhead.
		const scene = renderIntermediateDiagram(rankGapFlowchart);
		const [xs, ys] = (["x", "y"] as const).map((axis) =>
			scene.elements.flatMap((e) =>
				e.type === "arrow"
					? e.points.map((point) => point[axis])
					: e.type === "node"
						? [e[axis], e[axis] + (axis === "x" ? e.width : e.height)]
						: [],
			),
		);
		const [width, height] = [
			Math.max(...xs!) - Math.min(...xs!),
			Math.max(...ys!) - Math.min(...ys!),
		];
		const scale = routingQualityScale({ width, height });
		const [reach, wide] = [routingJogReach(scale), routingWideBend(scale)];
		const line = scene.elements.find((e) => e.type === "arrow" && e.edgeId === "edge-14");
		if (line?.type !== "arrow") throw new Error("No line for edge-14");
		const turns = line.points.filter((point, index) => {
			const [before, after] = [line.points[index - 1], line.points[index + 1]];
			return (
				!before ||
				!after ||
				!(
					(before.x === point.x && point.x === after.x) ||
					(before.y === point.y && point.y === after.y)
				)
			);
		});
		const [start, end] = [turns[0]!, turns.at(-1)!];
		// A step narrower than a deliberate bend, each of its turns past a jog's reach of the end beside it.
		expect(turns).toHaveLength(4);
		expect(Math.abs(turns[2]!.x - turns[1]!.x)).toBeLessThan(wide);
		expect(turns[1]!.y - start.y).toBeGreaterThan(reach);
		expect(end.y - turns[2]!.y).toBeGreaterThan(reach);
		// It grows no further than tightening allows.
		expect((height + 40) / (width + 40)).toBeLessThan(2.3);
	});
});
