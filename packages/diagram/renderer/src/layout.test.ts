import { describe, expect, it } from "vitest";
import {
	candidateRouteQuality,
	flowchartFixture,
	getCanvasValidationIssues,
	parseFlowchartDiagram,
	routingFixtures,
	routingQualityFindings,
	routingQualityScale,
} from "@sketchi/diagram-core";
import { renderIntermediateDiagram, type NodeSceneElement, type ScenePoint } from "./scene";

const directions = ["TB", "BT", "LR", "RL"] as const;
type Direction = (typeof directions)[number];
type Fixture = (typeof routingFixtures)[keyof typeof routingFixtures];

const render = (
	fixture: Fixture,
	direction: Direction,
	edgeRouting: "orthogonal" | "straight" | "curved" = "orthogonal",
) => renderIntermediateDiagram({ ...fixture, layout: { direction, edgeRouting } });

const scenes = new Map<string, ReturnType<typeof renderIntermediateDiagram>>();
const rendered = (name: keyof typeof routingFixtures, direction: Direction) => {
	const key = `${name}:${direction}`;
	if (!scenes.has(key)) scenes.set(key, render(routingFixtures[name], direction));
	return scenes.get(key)!;
};

const nodesOf = (scene: ReturnType<typeof renderIntermediateDiagram>) =>
	scene.elements.filter((e): e is NodeSceneElement => e.type === "node");
const arrowsOf = (scene: ReturnType<typeof renderIntermediateDiagram>) =>
	scene.elements.filter((e) => e.type === "arrow");
const center = (node: NodeSceneElement) => ({
	x: node.x + node.width / 2,
	y: node.y + node.height / 2,
});

/** Long side over short side of the drawn nodes and arrows, with Sketchi's 20-unit export padding. */
function exportAspect(scene: ReturnType<typeof renderIntermediateDiagram>): number {
	const points = [
		...nodesOf(scene).flatMap((n) => [
			{ x: n.x, y: n.y },
			{ x: n.x + n.width, y: n.y + n.height },
		]),
		...arrowsOf(scene).flatMap((a) => (a.type === "arrow" ? a.points : [])),
	];
	const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)) + 40;
	const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)) + 40;
	return Math.max(width / height, height / width);
}

/** A route's corners alone, so a line crossing it where it runs straight on counts once. */
function corners(points: readonly ScenePoint[]): ScenePoint[] {
	return points.filter((p, i) => {
		const [a, b] = [points[i - 1], points[i + 1]];
		return !a || !b || !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
	});
}

/** Interior crossings between the axis-aligned runs of different arrows. */
function crossings(scene: ReturnType<typeof renderIntermediateDiagram>): string[] {
	const arrows = arrowsOf(scene).flatMap((a) =>
		a.type === "arrow" ? [{ ...a, points: corners(a.points) }] : [],
	);
	const found: string[] = [];
	const inside = (value: number, p: number, q: number) =>
		value > Math.min(p, q) + 0.01 && value < Math.max(p, q) - 0.01;
	for (const [index, a] of arrows.entries())
		for (const b of arrows.slice(index + 1))
			for (const [i, p] of a.points.slice(0, -1).entries())
				for (const [j, r] of b.points.slice(0, -1).entries()) {
					const q = a.points[i + 1]!;
					const u = b.points[j + 1]!;
					const [h0, h1, v0, v1] =
						p.y === q.y && r.x === u.x
							? [p, q, r, u]
							: p.x === q.x && r.y === u.y
								? [r, u, p, q]
								: [];
					if (h0 && h1 && v0 && v1 && inside(v0.x, h0.x, h1.x) && inside(h0.y, v0.y, v1.y))
						found.push(`${a.edgeId} x ${b.edgeId}`);
				}
	return found;
}

/** Jogs, near-coincident corridors, touching arrowheads and lines through an arrowhead. */
function readerFindings(scene: ReturnType<typeof renderIntermediateDiagram>): number {
	const nodes = nodesOf(scene);
	const arrows = arrowsOf(scene).flatMap((a) => (a.type === "arrow" ? [a] : []));
	const points = [
		...nodes.flatMap((n) => [
			{ x: n.x, y: n.y },
			{ x: n.x + n.width, y: n.y + n.height },
		]),
		...arrows.flatMap((a) => a.points),
	];
	const scale = routingQualityScale({
		width: Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
		height: Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
	});
	const routes = arrows.map((a) => ({
		id: a.edgeId,
		points: a.points,
		sourceId: a.sourceNodeId,
		targetId: a.targetNodeId,
	}));
	const quality = candidateRouteQuality(routes, scale);
	return (
		routingQualityFindings(routes, scale).length +
		routes.filter((route) => quality(route).arrowheadsCrossed > 0).length
	);
}

/** Flow and band axes: a TB flow runs down `y` and wraps into columns along `x`. */
function axes(direction: Direction) {
	const vertical = direction === "TB" || direction === "BT";
	return {
		along: vertical ? ("y" as const) : ("x" as const),
		across: vertical ? ("x" as const) : ("y" as const),
		sign: direction === "TB" || direction === "LR" ? 1 : -1,
		forward: { TB: "bottom", BT: "top", LR: "right", RL: "left" }[direction],
		back: { TB: "top", BT: "bottom", LR: "left", RL: "right" }[direction],
	};
}

function side(node: NodeSceneElement, point: ScenePoint) {
	const x = (point.x - center(node).x) / (node.width / 2);
	const y = (point.y - center(node).y) / (node.height / 2);
	return Math.abs(x) > Math.abs(y) ? (x < 0 ? "left" : "right") : y < 0 ? "top" : "bottom";
}

describe("long flows wrap into bands that read in the requested direction", () => {
	const chain = routingFixtures["package-chain"];
	const order = chain.nodes.map((node) => node.id);

	it.each(directions)("wraps the seven-stage chain in %s", (direction) => {
		const scene = rendered("package-chain", direction);
		const { along, across, sign, forward, back } = axes(direction);
		const nodes = new Map(nodesOf(scene).map((node) => [node.nodeId, node]));
		const arrows = arrowsOf(scene).flatMap((a) => (a.type === "arrow" ? [a] : []));

		// Nothing is dropped, merged or relabeled.
		expect([...nodes.keys()].sort()).toEqual([...order].sort());
		expect(arrows.map((a) => [a.edgeId, a.sourceNodeId, a.targetNodeId, a.label])).toEqual(
			chain.edges.map((e) => [e.id, e.source, e.target, e.label]),
		);

		// Consecutive stages sharing a centerline across the flow form a band.
		const bands: string[][] = [];
		for (const id of order) {
			const previous = bands.at(-1);
			const last = previous && nodes.get(previous.at(-1)!)!;
			if (last && Math.abs(center(last)[across] - center(nodes.get(id)!)[across]) < 1)
				previous.push(id);
			else bands.push([id]);
		}
		expect(bands.length).toBeGreaterThanOrEqual(2);
		for (const band of bands) {
			expect(band.length).toBeGreaterThanOrEqual(2);
			// Each band runs in the requested direction...
			for (const [index, id] of band.slice(1).entries())
				expect(
					sign * (center(nodes.get(id)!)[along] - center(nodes.get(band[index]!)!)[along]),
				).toBeGreaterThan(0);
		}
		// ...and bands follow each other down the page (rows) or across it (columns).
		for (const [index, band] of bands.slice(1).entries())
			expect(center(nodes.get(band[0]!)!)[across]).toBeGreaterThan(
				center(nodes.get(bands[index]!.at(-1)!)!)[across],
			);

		// A continuation leaves forward, crosses the gap between bands and arrives forward.
		for (const [index, band] of bands.slice(1).entries()) {
			const from = nodes.get(bands[index]!.at(-1)!)!;
			const to = nodes.get(band[0]!)!;
			const arrow = arrows.find(
				(a) => a.sourceNodeId === from.nodeId && a.targetNodeId === to.nodeId,
			)!;
			expect(side(from, arrow.points[0])).toBe(forward);
			expect(side(to, arrow.points.at(-1)!)).toBe(back);
			const size = across === "x" ? "width" : "height";
			const gapStart = Math.max(
				...bands[index]!.map((id) => nodes.get(id)![across] + nodes.get(id)![size]),
			);
			const gapEnd = Math.min(...band.map((id) => nodes.get(id)![across]));
			expect(
				arrow.points.some((p, i) => {
					const next = arrow.points[i + 1];
					return next && p[across] === next[across] && p[across] > gapStart && p[across] < gapEnd;
				}),
			).toBe(true);
		}

		// One row ran about 22:1; the bands land within the 2.5:1 the reader expects.
		expect(exportAspect(scene)).toBeLessThan(2.5);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});

	it.each(["straight", "curved"] as const)("keeps %s routing in one row", (edgeRouting) => {
		const scene = render(chain, "LR", edgeRouting);
		const ys = new Set(nodesOf(scene).map((node) => Math.round(center(node).y)));
		expect(ys.size).toBe(1);
	});

	it.each(directions)("keeps a short chain in one row or column in %s", (direction) => {
		const scene = render(
			parseFlowchartDiagram({
				...flowchartFixture,
				type: "flowchart",
				nodes: ["A", "B", "C", "D"].map((id, index) => ({
					id,
					label: `Step ${id}`,
					kind: index === 0 ? "start" : index === 3 ? "end" : "process",
				})),
				edges: [
					{ id: "ab", source: "A", target: "B", label: "Hand off to the next step" },
					{ id: "bc", source: "B", target: "C", label: "Hand off to the next step" },
					{ id: "cd", source: "C", target: "D", label: "Hand off to the next step" },
				],
			}),
			direction,
		);
		const { across } = axes(direction);
		expect(new Set(nodesOf(scene).map((node) => Math.round(center(node)[across]))).size).toBe(1);
	});

	it.each(["LR", "RL"] as const)("wraps the same five steps from an 8:1 row in %s", (direction) => {
		expect(exportAspect(rendered("scope-bypass", direction))).toBeLessThan(2.5);
	});

	it.each(directions)("does not wrap a chain whose every cut a loop spans in %s", (direction) => {
		const ids = ["A", "B", "C", "D", "E", "F", "G", "H"];
		const scene = render(
			parseFlowchartDiagram({
				...flowchartFixture,
				type: "flowchart",
				nodes: [
					...ids.map((id, index) => ({
						id,
						label: index === ids.length - 1 ? "Checks passed?" : `Stage ${id}`,
						kind: index === 0 ? "start" : index === ids.length - 1 ? "decision" : "process",
					})),
					{ id: "done", label: "Done", kind: "end" },
				],
				edges: [
					...ids
						.slice(1)
						.map((id, index) => ({ id: `e${index}`, source: ids[index]!, target: id })),
					// A cut after the start would leave it a band of one rank.
					{ id: "retry", source: "H", target: "B", label: "Retry" },
					{ id: "finish", source: "H", target: "done", label: "Yes" },
				],
			}),
			direction,
		);
		const { along, sign } = axes(direction);
		const nodes = new Map(nodesOf(scene).map((node) => [node.nodeId, node]));
		for (const [index, id] of ids.slice(1).entries())
			expect(
				sign * (center(nodes.get(id)!)[along] - center(nodes.get(ids[index]!)!)[along]),
			).toBeGreaterThan(0);
	});
});

/** A column of approval gates, each with a stop branch: four gates run about 3.2:1, five about 3.9:1. */
function gatedRelease(checks: number) {
	const nodes = [{ id: "start", label: "Request received", kind: "start" }];
	const edges: { id: string; source: string; target: string; label?: string }[] = [];
	let previous = "start";
	for (let i = 1; i <= checks; i += 1) {
		nodes.push(
			{ id: `step${i}`, label: `Prepare stage ${i} evidence`, kind: "process" },
			{ id: `check${i}`, label: `Stage ${i} approved?`, kind: "decision" },
			{ id: `stop${i}`, label: `Stop at stage ${i}`, kind: "end" },
		);
		edges.push(
			{
				id: `to-step${i}`,
				source: previous,
				target: `step${i}`,
				...(previous.startsWith("check") ? { label: "Yes" } : {}),
			},
			{ id: `to-check${i}`, source: `step${i}`, target: `check${i}` },
			{ id: `stop${i}`, source: `check${i}`, target: `stop${i}`, label: "No" },
		);
		previous = `check${i}`;
	}
	nodes.push({ id: "done", label: "Release approved", kind: "end" });
	edges.push({ id: "finish", source: previous, target: "done", label: "Yes" });
	return parseFlowchartDiagram({
		...flowchartFixture,
		type: "flowchart",
		id: `gated-release-${checks}`,
		nodes,
		edges,
	});
}

/** Every edge of a loop-free flow runs forward along it only when nothing wrapped. */
function runsForward(scene: ReturnType<typeof renderIntermediateDiagram>, direction: Direction) {
	const { along, sign } = axes(direction);
	const nodes = new Map(nodesOf(scene).map((node) => [node.nodeId, node]));
	return arrowsOf(scene).every(
		(arrow) =>
			arrow.type === "arrow" &&
			sign *
				(center(nodes.get(arrow.targetNodeId)!)[along] -
					center(nodes.get(arrow.sourceNodeId)!)[along]) >
				0,
	);
}

/** A CI release gate as a generated sample drew it: its only clean cut falls three steps from the end. */
const ciReleaseGate = parseFlowchartDiagram({
	...flowchartFixture,
	type: "flowchart",
	id: "ci-release-gate",
	nodes: [
		["commit", "A commit is merged", "start"],
		["tests", "Test suite runs", "process"],
		["test-result", "Tests pass?", "decision"],
		["block", "Block release", "end"],
		["artifact", "Build an artifact", "process"],
		["scan", "Run a security scan", "process"],
		["scan-result", "Clean scan?", "decision"],
		["canary", "Deploy a canary", "process"],
		["health", "Canary is healthy?", "decision"],
		["production", "Promote to production", "end"],
		["rollback", "Roll back the canary", "end"],
	].map(([id, label, kind]) => ({ id: id!, label: label!, kind })),
	edges: [
		["commit", "tests"],
		["tests", "test-result"],
		["test-result", "block", "Failed tests"],
		["test-result", "artifact", "Passing tests"],
		["artifact", "scan"],
		["scan", "scan-result"],
		["scan-result", "block", "Failed scan"],
		["scan-result", "canary", "Clean scan"],
		["canary", "health"],
		["health", "production", "Yes"],
		["health", "rollback", "No"],
	].map(([source, target, label], index) => ({
		id: `edge-${index + 1}`,
		source: source!,
		target: target!,
		...(label ? { label } : {}),
	})),
});

describe("tall columns wrap into even columns at about 2.5:1, as rows do", () => {
	it.each(["TB", "BT"] as const)(
		"keeps a column in one when its only cut would leave a short column beside a long one in %s",
		(direction) => {
			// Loan underwriting cuts two steps from the start, the release gate three
			// from the end, and five steps cut two from three: a short column would
			// stand beside a long one, reached by a connector across empty space.
			for (const scene of [
				rendered("loan-application-underwriting", direction),
				rendered("scope-bypass", direction),
				render(ciReleaseGate, direction),
			])
				expect(runsForward(scene, direction)).toBe(true);
		},
	);

	it.each(["TB", "BT"] as const)(
		"wraps four and five gates, from about 3.2:1 and 4:1, into even columns in %s",
		(direction) => {
			for (const checks of [4, 5]) {
				const scene = render(gatedRelease(checks), direction);
				expect(runsForward(scene, direction)).toBe(false);
				expect(exportAspect(scene)).toBeLessThan(2.5);
				expect(getCanvasValidationIssues(scene)).toEqual([]);
			}
		},
	);

	it.each(["TB", "BT"] as const)("keeps a column under 2.5:1 in one column in %s", (direction) => {
		const scene = rendered("content-moderation", direction);
		expect(exportAspect(scene)).toBeLessThan(2.5);
		expect(runsForward(scene, direction)).toBe(true);
	});
});

describe("avoidable crossings", () => {
	it.each(directions)("lands a bypass branch on the side it comes from in %s", (direction) => {
		expect(crossings(rendered("scope-bypass", direction))).toEqual([]);
	});

	it.each(directions)("routes nested failure arrivals without crossing in %s", (direction) => {
		// LR and RL keep one crossing between the two failures; a count may only fall.
		expect(crossings(rendered("rollout-failures", direction)).length).toBeLessThanOrEqual(
			direction === "TB" || direction === "BT" ? 0 : 1,
		);
	});

	it.each(directions)(
		"reorders ranks so patient intake routes without crossings in %s",
		(direction) => {
			expect(crossings(rendered("patient-intake-scheduling", direction))).toEqual([]);
		},
	);

	it("keeps a decision fan-in no worse than main in BT", () => {
		// Review repro: ordering arrivals by approach alone drew 3 crossings here; main draws 1.
		const scene = render(
			parseFlowchartDiagram({
				...flowchartFixture,
				type: "flowchart",
				nodes: [
					["n0", "start"],
					["n2", "decision"],
					["n3", "decision"],
					["n4", "end"],
					["n5", "end"],
					["n8", "process"],
					["n9", "end"],
				].map(([id, kind]) => ({ id: id!, kind, label: id! })),
				edges: [
					["e0", "n0", "n2"],
					["e11", "n2", "n5"],
					["e13", "n2", "n4"],
					["e14", "n2", "n8"],
					["e15", "n3", "n8"],
					["e16", "n3", "n9"],
					["e17", "n3", "n2"],
					["e18", "n3", "n4"],
					["e20", "n8", "n3"],
				].map(([id, source, target]) => ({
					id: id!,
					source: source!,
					target: target!,
					label: id!,
				})),
			}),
			"BT",
		);
		expect(crossings(scene).length).toBeLessThanOrEqual(1);
		expect(readerFindings(scene)).toBe(0);
	});

	it.each(directions)("keeps declaration order where every order crosses in %s", (direction) => {
		// Two sources each feed both targets: one crossing is forced, so nothing reorders.
		const scene = render(
			parseFlowchartDiagram({
				...flowchartFixture,
				type: "flowchart",
				nodes: [
					{ id: "start", label: "Start", kind: "start" },
					{ id: "a", label: "Collect A", kind: "process" },
					{ id: "b", label: "Collect B", kind: "process" },
					{ id: "c", label: "Report C", kind: "end" },
					{ id: "d", label: "Report D", kind: "end" },
				],
				edges: [
					{ id: "sa", source: "start", target: "a" },
					{ id: "sb", source: "start", target: "b" },
					{ id: "ac", source: "a", target: "c" },
					{ id: "ad", source: "a", target: "d" },
					{ id: "bc", source: "b", target: "c" },
					{ id: "bd", source: "b", target: "d" },
				],
			}),
			direction,
		);
		const { across } = axes(direction);
		const at = (id: string) => center(nodesOf(scene).find((node) => node.nodeId === id)!)[across];
		expect(at("a")).toBeLessThan(at("b"));
		expect(at("c")).toBeLessThan(at("d"));
	});
});
