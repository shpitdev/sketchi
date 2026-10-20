import { describe, expect, it } from "vitest";
import {
	flowchartFixture,
	getCanvasValidationIssues,
	laneFixtures,
	laneRegionIssues,
	laneStressFixtures,
	parseIntermediateDiagram,
	routingQualityFindings,
	routingQualityScale,
} from "@sketchi/diagram-core";
import {
	arrowCrossings,
	renderIntermediateDiagram,
	type ArrowSceneElement,
	type NodeSceneElement,
	type RenderedDiagramScene,
} from "./scene";

const directions = ["TB", "BT", "LR", "RL"] as const;
type Direction = (typeof directions)[number];
type Name = keyof typeof laneFixtures;
const names = Object.keys(laneFixtures) as Name[];

const scenes = new Map<string, RenderedDiagramScene>();
function rendered(name: Name, direction: Direction = laneFixtures[name].layout.direction) {
	const key = `${name}:${direction}`;
	if (!scenes.has(key))
		scenes.set(
			key,
			renderIntermediateDiagram({
				...laneFixtures[name],
				layout: { direction, edgeRouting: "orthogonal" },
			}),
		);
	return scenes.get(key)!;
}

const nodesOf = (scene: RenderedDiagramScene) =>
	scene.elements.filter((e): e is NodeSceneElement => e.type === "node");
const arrowsOf = (scene: RenderedDiagramScene) =>
	scene.elements.filter((e): e is ArrowSceneElement => e.type === "arrow");
const arrow = (scene: RenderedDiagramScene, edgeId: string) =>
	arrowsOf(scene).find((candidate) => candidate.edgeId === edgeId)!;
const node = (scene: RenderedDiagramScene, nodeId: string) =>
	nodesOf(scene).find((candidate) => candidate.nodeId === nodeId)!;

describe.each(directions)("swimlane flowcharts %s", (direction) => {
	it.each(names)("draws %s with every step in its lane and every route clear", (name) => {
		const fixture = laneFixtures[name];
		const scene = rendered(name, direction);
		expect(laneRegionIssues(scene, fixture)).toEqual([]);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		// Lanes sit under everything, each band then its header and name, locked.
		expect(scene.zOrder.slice(0, 3 * fixture.lanes!.length)).toEqual(
			fixture.lanes!.flatMap((lane) => [
				`lane:${lane.id}`,
				`lane:${lane.id}:header`,
				`lane:${lane.id}:label`,
			]),
		);
		for (const lane of fixture.lanes!) {
			expect(node(scene, `lane:${lane.id}`)).toMatchObject({
				rendererRole: "swimlane",
				locked: true,
			});
			expect(scene.elements.find((e) => e.id === `lane:${lane.id}:label`)).toMatchObject({
				type: "text",
				containerId: `lane:${lane.id}:header`,
				locked: true,
			});
		}
	});
});

describe("swimlane layout", () => {
	it("stacks rows for a horizontal flow and columns for a vertical one, in declared order", () => {
		for (const [direction, axis] of [
			["LR", "y"],
			["TB", "x"],
		] as const) {
			const starts = laneFixtures["order-fulfilment"].lanes!.map(
				(lane) => node(rendered("order-fulfilment", direction), `lane:${lane.id}`)[axis],
			);
			expect(starts).toEqual([...starts].sort((a, b) => a - b));
			expect(new Set(starts).size).toBe(starts.length);
		}
	});

	it("runs a handoff to the neighboring lane straight across the boundary", () => {
		const scene = rendered("order-fulfilment");
		// Place order → Review order, In stock? → Pick items, Ship → Send invoice.
		for (const edgeId of ["e1", "e4", "e7"]) expect(arrow(scene, edgeId).points).toHaveLength(2);
		const middle = (id: string) => node(scene, id).x + node(scene, id).width / 2;
		expect(middle("place")).toBe(middle("review"));
	});

	it("advances a column for a step in the same lane or two lanes away", () => {
		const scene = rendered("order-fulfilment");
		// Send invoice (Billing) → Pay the invoice (Customer) skips two lanes.
		expect(node(scene, "pay").x).toBeGreaterThan(node(scene, "invoice").x);
		expect(node(scene, "pack").x).toBeGreaterThan(node(scene, "pick").x);
	});

	// Code Mode draws LR and TB; a backward flow keeps the sides apart only when
	// that routes no worse.
	it.each(["TB", "LR", "RL"] as const)(
		"never brings a line into a step by a side another line leaves it by, %s",
		(direction) => {
			// The side an end uses is where its first run heads: up leaves by the top.
			const sideOf = (from: { x: number; y: number }, to: { x: number; y: number }) =>
				Math.abs(to.x - from.x) > Math.abs(to.y - from.y)
					? to.x > from.x
						? "right"
						: "left"
					: to.y > from.y
						? "bottom"
						: "top";
			for (const name of names) {
				const ends = new Map<string, Set<string>>();
				for (const route of arrowsOf(rendered(name, direction))) {
					const [first, second] = route.points;
					const [last, before] = [route.points.at(-1)!, route.points.at(-2)!];
					const departure = `${route.sourceNodeId}:${sideOf(first, second!)}`;
					const arrival = `${route.targetNodeId}:${sideOf(last, before)}`;
					ends.set(departure, new Set([...(ends.get(departure) ?? []), "leaves"]));
					ends.set(arrival, new Set([...(ends.get(arrival) ?? []), "arrives"]));
				}
				expect(
					[...ends].filter(([, roles]) => roles.size > 1).map(([side]) => `${name} ${side}`),
				).toEqual([]);
			}
		},
	);

	it("gives each arrival on a step's side its own port, well apart", () => {
		const gaps: number[] = [];
		for (const name of names)
			for (const direction of ["LR", "TB"] as const) {
				const arrivals = new Map<string, number[]>();
				for (const route of arrowsOf(rendered(name, direction))) {
					const [last, before] = [route.points.at(-1)!, route.points.at(-2)!];
					const vertical = Math.abs(last.x - before.x) < 0.01;
					const key = `${route.targetNodeId}:${vertical ? `y${last.y}` : `x${last.x}`}`;
					arrivals.set(key, [...(arrivals.get(key) ?? []), vertical ? last.x : last.y]);
				}
				for (const at of arrivals.values()) {
					const sorted = [...at].sort((a, b) => a - b);
					gaps.push(...sorted.slice(1).map((value, index) => value - sorted[index]!));
				}
			}
		expect(gaps.length).toBeGreaterThan(0);
		expect(Math.min(...gaps)).toBeGreaterThanOrEqual(54);
	});

	it("keeps the incident loop clear of the lane borders and the flow at a readable aspect", () => {
		const scene = rendered("incident-response");
		const bands = nodesOf(scene).filter((shape) => shape.rendererRole === "swimlane");
		const borders = [...new Set(bands.flatMap((band) => [band.y, band.y + band.height]))];
		const loop = arrow(scene, "e7").points;
		for (const [index, point] of loop.entries()) {
			const next = loop[index + 1];
			if (!next || Math.abs(point.y - next.y) > 0.01) continue;
			for (const border of borders) expect(Math.abs(point.y - border)).toBeGreaterThanOrEqual(24);
		}
		expect((scene.width + 40) / (scene.height + 40)).toBeLessThan(2.75);
	});

	it("routes the fixtures with no reader-scale finding", () => {
		for (const name of ["order-fulfilment", "hiring", "incident-response"] as const) {
			const scene = rendered(name);
			const routes = arrowsOf(scene).map((a) => ({
				id: a.id,
				points: a.points,
				sourceId: a.sourceNodeId,
				targetId: a.targetNodeId,
			}));
			expect(routingQualityFindings(routes, routingQualityScale(scene))).toEqual([]);
		}
	});

	it("keeps every stress case's steps in their lanes and its routes clear", () => {
		for (const fixture of Object.values(laneStressFixtures))
			for (const direction of ["LR", "TB"] as const) {
				const scene = renderIntermediateDiagram({
					...fixture,
					layout: { direction, edgeRouting: "orthogonal" },
				});
				expect(laneRegionIssues(scene, fixture)).toEqual([]);
				expect(getCanvasValidationIssues(scene)).toEqual([]);
			}
	});

	it("draws lanes whose ids extend each other under ids of their own", () => {
		// Lane "a" draws a header and lane "a:header" a band; a node may be named like either.
		const scene = renderIntermediateDiagram({
			id: "colliding-lanes",
			title: "Colliding lane ids",
			lanes: [
				{ id: "a", label: "First" },
				{ id: "a:header", label: "Second" },
			],
			nodes: [
				{ id: "lane:a", label: "Start", kind: "start", lane: "a" },
				{ id: "done", label: "Done", kind: "end", lane: "a:header" },
			],
			edges: [{ id: "e1", source: "lane:a", target: "done" }],
			layout: { direction: "LR", edgeRouting: "orthogonal" },
		});
		const ids = scene.elements.map((element) => element.id);
		const nodeIds = nodesOf(scene).map((shape) => shape.nodeId);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(nodeIds).size).toBe(nodeIds.length);
		expect(new Set(scene.zOrder).size).toBe(scene.zOrder.length);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(
			laneRegionIssues(scene, {
				lanes: [{ id: "a" }, { id: "a:header" }],
				nodes: [
					{ id: "lane:a", lane: "a" },
					{ id: "done", lane: "a:header" },
				],
			}),
		).toEqual([]);
	});

	it("renders a flowchart without lanes exactly as before", () => {
		const { lanes: _lanes, ...unlaned } = flowchartFixture;
		expect(renderIntermediateDiagram({ ...unlaned, lanes: [] })).toEqual(
			renderIntermediateDiagram(unlaned),
		);
		expect(
			nodesOf(renderIntermediateDiagram(unlaned)).filter((shape) => shape.rendererRole),
		).toEqual([]);
	});

	it("rejects lanes with groups, an undeclared lane and a node without one", () => {
		const fixture = laneFixtures.hiring;
		expect(() =>
			parseIntermediateDiagram({ ...fixture, groups: [{ id: "g", label: "G" }] }),
		).toThrow("A diagram with lanes cannot also declare groups.");
		expect(() =>
			parseIntermediateDiagram({
				...fixture,
				nodes: fixture.nodes.map((n) => (n.id === "hire" ? { ...n, lane: "board" } : n)),
			}),
		).toThrow('Node "hire" references missing lane "board".');
		expect(() =>
			parseIntermediateDiagram({
				...fixture,
				nodes: fixture.nodes.map(({ lane: _lane, ...n }) => n),
			}),
		).toThrow('Node "apply" has no lane.');
	});
});

/** Width over height, either way up, of a scene in the hosted PNG's 20-unit frame. */
const exportAspect = ({ width, height }: RenderedDiagramScene) =>
	(Math.max(width, height) - 96 + 40) / (Math.min(width, height) - 96 + 40);

/** Round 19's swimlane-incident-response (Sol s2): 2.61:1 before its columns closed up. */
const INCIDENT = {
	id: "incident-response",
	title: "Incident response",
	lanes: [
		{ id: "oncall", label: "On-call" },
		{ id: "sre", label: "SRE" },
		{ id: "comms", label: "Comms" },
	],
	nodes: [
		{ id: "alert", label: "Alert fires", kind: "start", lane: "oncall" },
		{ id: "triage", label: "Triages the alert", kind: "process", lane: "oncall" },
		{ id: "page", label: "Pages the SRE", kind: "process", lane: "oncall" },
		{ id: "investigate", label: "Investigates the incident", kind: "process", lane: "sre" },
		{ id: "mitigate", label: "Applies a mitigation", kind: "process", lane: "sre" },
		{ id: "update", label: "Posts a status update", kind: "process", lane: "comms" },
		{ id: "resolved", label: "Is the incident resolved?", kind: "decision", lane: "oncall" },
		{ id: "publish", label: "Publishes the resolution", kind: "end", lane: "comms" },
	],
	edges: [
		{ id: "edge-1", source: "alert", target: "triage" },
		{ id: "edge-2", source: "triage", target: "page" },
		{ id: "edge-3", source: "page", target: "investigate" },
		{ id: "edge-4", source: "investigate", target: "mitigate" },
		{ id: "edge-5", source: "mitigate", target: "update" },
		{ id: "edge-6", source: "update", target: "resolved" },
		{ id: "edge-7", source: "resolved", target: "investigate", label: "No" },
		{ id: "edge-8", source: "resolved", target: "publish", label: "Yes" },
	],
	layout: { direction: "LR", edgeRouting: "orthogonal" },
} as const;

/** An Oct 19 order-fulfilment run: Pay invoice hands off to Record payment two lanes down. */
const ORDER = {
	id: "order-fulfilment",
	title: "Order Fulfilment",
	lanes: [
		{ id: "customer", label: "Customer" },
		{ id: "sales", label: "Sales" },
		{ id: "warehouse", label: "Warehouse" },
		{ id: "finance", label: "Finance" },
	],
	nodes: [
		{ id: "place", label: "Place order", kind: "start", lane: "customer" },
		{ id: "review", label: "Review order", kind: "process", lane: "sales" },
		{ id: "stock", label: "Are items in stock?", kind: "decision", lane: "sales" },
		{ id: "backorder", label: "Notify customer of backorder", kind: "end", lane: "sales" },
		{ id: "pick", label: "Pick items", kind: "process", lane: "warehouse" },
		{ id: "pack", label: "Pack order", kind: "process", lane: "warehouse" },
		{ id: "ship", label: "Ship order", kind: "process", lane: "warehouse" },
		{ id: "invoice", label: "Send invoice", kind: "process", lane: "finance" },
		{ id: "pay", label: "Pay invoice", kind: "process", lane: "customer" },
		{ id: "record", label: "Record payment", kind: "end", lane: "finance" },
	],
	edges: [
		{ id: "edge-1", source: "place", target: "review" },
		{ id: "edge-2", source: "review", target: "stock" },
		{ id: "edge-3", source: "stock", target: "backorder", label: "No" },
		{ id: "edge-4", source: "stock", target: "pick", label: "Yes" },
		{ id: "edge-5", source: "pick", target: "pack" },
		{ id: "edge-6", source: "pack", target: "ship" },
		{ id: "edge-7", source: "ship", target: "invoice" },
		{ id: "edge-8", source: "invoice", target: "pay" },
		{ id: "edge-9", source: "pay", target: "record" },
	],
	layout: { direction: "LR", edgeRouting: "orthogonal" },
} as const;

/** Lanes stay intact: every step in its band, every band the pool's full length, and clean lines. */
function expectIntactLanes(scene: RenderedDiagramScene, fixture: typeof INCIDENT | typeof ORDER) {
	expect(laneRegionIssues(scene, fixture)).toEqual([]);
	expect(getCanvasValidationIssues(scene)).toEqual([]);
	const bands = nodesOf(scene).filter((shape) => shape.rendererRole === "swimlane");
	expect(bands).toHaveLength(fixture.lanes.length);
	for (const band of bands) expect([band.x, band.width]).toEqual([bands[0]!.x, bands[0]!.width]);
	const routes = arrowsOf(scene);
	expect(arrowCrossings(routes)).toBe(0);
	expect(
		routingQualityFindings(
			routes.map((route) => ({ id: route.edgeId, points: route.points })),
			routingQualityScale(scene),
		),
	).toEqual([]);
}

describe("long rows of lanes", () => {
	it("closes up round 19's incident response to within 2.4:1", () => {
		const scene = renderIntermediateDiagram(INCIDENT);
		expect(exportAspect(scene)).toBeLessThanOrEqual(2.4);
		expectIntactLanes(scene, INCIDENT);
	});

	it("hands a step off straight across lanes that stand empty in its column", () => {
		const scene = renderIntermediateDiagram(ORDER);
		// Pay invoice (Customer) to Record payment (Finance), past Sales and Warehouse.
		expect(arrow(scene, "edge-9").points).toHaveLength(2);
		const middle = (id: string) => node(scene, id).x + node(scene, id).width / 2;
		expect(middle("record")).toBe(middle("pay"));
		expectIntactLanes(scene, ORDER);
	});

	it("keeps a row of lanes within 2.3:1 as it was", () => {
		// Without its last two steps the order reads short enough to keep its columns.
		const short = {
			...ORDER,
			nodes: ORDER.nodes.filter((step) => step.id !== "pay" && step.id !== "record"),
			edges: ORDER.edges.filter((edge) => edge.id !== "edge-8" && edge.id !== "edge-9"),
		};
		const scene = renderIntermediateDiagram(short);
		expect(exportAspect(scene)).toBeLessThan(2.3);
		// Pack and ship keep two stubs and a port's spacing between them, not a compacted 56.
		expect(
			node(scene, "ship").x - node(scene, "pack").x - node(scene, "pack").width,
		).toBeGreaterThanOrEqual(90);
	});
});
