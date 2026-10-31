import { describe, expect, it } from "vitest";
import {
	CANVAS_SHAPE_CURVE,
	bypassingHybridFlowcharts,
	corridorHybridFlowchart,
	describedArchitectureFlowchart,
	describedHybridFlowchart,
	canvasBoundTextBox,
	canvasShapeOutline,
	isCanvasComposedShape,
	canvasNodeIconBox,
	getCanvasValidationIssues,
	groupFixtures,
	leftToRightHybridFlowchart,
	parseFlowchartDiagram,
	queriedArchitectureFlowchart,
	requestPathFlowcharts,
	requestedArchitectureFlowchart,
	routingJogReach,
	routingCorridorGap,
	routingCorridorRun,
	routingQualityScale,
	routingWideBend,
	stackedHybridFlowchart,
	syncedHybridFlowchart,
	zoneFixtures,
	zoneRegionIssues,
	zoneStressFixtures,
	type IntermediateDiagram,
} from "@sketchi/diagram-core";
import {
	arrowCrossings,
	renderIntermediateDiagram,
	type NodeSceneElement,
	type RenderedDiagramScene,
} from "./scene";

const directions = ["TB", "BT", "LR", "RL"] as const;
type Direction = (typeof directions)[number];
const fixtures: Record<string, IntermediateDiagram> = {
	...zoneFixtures,
	...zoneStressFixtures,
	...requestPathFlowcharts,
};

const scenes = new Map<string, RenderedDiagramScene>();
function rendered(
	name: string,
	direction: Direction = fixtures[name]!.layout.direction,
	fixture: IntermediateDiagram = fixtures[name]!,
) {
	const key = `${name}:${direction}`;
	if (!scenes.has(key))
		scenes.set(
			key,
			renderIntermediateDiagram({
				...fixture,
				layout: { direction, edgeRouting: "orthogonal" },
			}),
		);
	return scenes.get(key)!;
}

const zonesOf = (scene: RenderedDiagramScene) =>
	scene.elements.filter(
		(e): e is NodeSceneElement => e.type === "node" && e.rendererRole === "zone",
	);
const nodeOf = (scene: RenderedDiagramScene, id: string) =>
	scene.elements.find((e): e is NodeSceneElement => e.type === "node" && e.nodeId === id)!;

// Width over height, either way up, of what the export draws: zones, nodes and lines.
const drawnAspect = (scene: RenderedDiagramScene) => {
	const points = scene.elements.flatMap((element) =>
		element.type === "arrow"
			? element.points
			: element.type === "node"
				? [
						{ x: element.x, y: element.y },
						{ x: element.x + element.width, y: element.y + element.height },
					]
				: [],
	);
	const [xs, ys] = [points.map((point) => point.x), points.map((point) => point.y)];
	const [width, height] = [
		Math.max(...xs) - Math.min(...xs) + 40,
		Math.max(...ys) - Math.min(...ys) + 40,
	];
	return Math.max(width, height) / Math.min(width, height);
};

describe.each(directions)("zoned flowcharts %s", (direction) => {
	it.each(Object.keys(fixtures))("draws %s with every zone nested, apart and clear", (name) => {
		const fixture = fixtures[name]!;
		const scene = rendered(name, direction);
		expect(zoneRegionIssues(scene, fixture)).toEqual([]);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		// Zones draw as locked rectangles, never frames, outermost first and under everything.
		expect(scene.elements.some((e) => e.type === "frame")).toBe(false);
		const zones = zonesOf(scene);
		const depth = (id: string): number => {
			const parent = fixture.groups!.find((group) => group.id === id)?.parent;
			return parent === undefined ? 1 : 1 + depth(parent);
		};
		expect(zones.map((zone) => depth(zone.id.slice("group:".length)))).toEqual(
			zones.map((zone) => depth(zone.id.slice("group:".length))).sort((a, b) => a - b),
		);
		expect(zones.every((zone) => zone.locked && zone.shape === "rectangle")).toBe(true);
		expect(scene.zOrder.slice(0, zones.length * 2)).toEqual(
			zones.flatMap((zone) => [zone.id, `zone-label:${zone.id.slice("group:".length)}`]),
		);
	});
});

describe("zone layout", () => {
	it("styles each zone by its kind", () => {
		const style = (scene: RenderedDiagramScene, id: string) => {
			const zone = zonesOf(scene).find((candidate) => candidate.id === `group:${id}`)!;
			return [zone.kind, zone.strokeStyle, zone.strokeWidth, zone.fillColor ?? "none"];
		};
		const aws = rendered("aws-three-tier");
		expect(style(aws, "region")).toEqual(["region", "dashed", 1, "none"]);
		expect(style(aws, "vpc")).toEqual(["vpc", "solid", 2, "none"]);
		expect(style(aws, "public")).toEqual(["subnet", "solid", 1, "#f6f1e7"]);
		const k8s = rendered("kubernetes-cluster");
		expect(style(k8s, "cluster")).toEqual(["cluster", "solid", 2, "none"]);
		expect(style(k8s, "backend")).toEqual(["namespace", "dashed", 1, "#efe6ec"]);
		const hybrid = rendered("hybrid-cloud");
		expect(style(hybrid, "onprem")).toEqual(["datacenter", "solid", 2, "none"]);
		expect(style(hybrid, "corp")).toEqual(["zone", "dotted", 1, "none"]);
		expect(style(hybrid, "aws")).toEqual(["cloud", "dashed", 2, "none"]);
	});

	it("puts each zone's label in a header strip above everything the zone holds", () => {
		const scene = rendered("depth-four");
		for (const zone of zonesOf(scene)) {
			const id = zone.id.slice("group:".length);
			const label = scene.elements.find((e) => e.id === `zone-label:${id}`)!;
			expect(label).toMatchObject({ type: "text", textAlign: "left", locked: true });
			const strip = zone.y + 36;
			const held = scene.elements.filter(
				(e): e is NodeSceneElement =>
					e.type === "node" &&
					e !== zone &&
					e.x >= zone.x &&
					e.x + e.width <= zone.x + zone.width &&
					e.y >= zone.y &&
					e.y + e.height <= zone.y + zone.height,
			);
			expect(held.length).toBeGreaterThan(0);
			for (const inner of held) expect(inner.y).toBeGreaterThanOrEqual(strip);
		}
	});

	it("routes the flow straight from outside through every zone it enters", () => {
		const scene = rendered("aws-three-tier");
		const arrow = scene.elements.find((e) => e.type === "arrow" && e.edgeId === "e1")!;
		expect(arrow.type === "arrow" && arrow.points).toHaveLength(2);
	});

	it("keeps the stated direction at every level of zones", () => {
		// Top to bottom, the namespaces a request crosses stack in its order.
		const k8s = rendered("kubernetes-cluster");
		const zone = (scene: RenderedDiagramScene, id: string) =>
			zonesOf(scene).find((candidate) => candidate.id === `group:${id}`)!;
		const [edge, frontend, backend] = ["edge", "frontend", "backend"].map((id) => zone(k8s, id));
		expect(edge!.y + edge!.height).toBeLessThan(frontend!.y);
		expect(frontend!.y + frontend!.height).toBeLessThan(backend!.y);
		// Left to right, the cloud stands beside the data center that feeds it; too
		// long for one row, its region wraps inside it, each row read left to right.
		const hybrid = rendered("hybrid-cloud");
		expect(zone(hybrid, "onprem").x + zone(hybrid, "onprem").width).toBeLessThan(
			zone(hybrid, "aws").x,
		);
		const [vpn, api] = [nodeOf(hybrid, "vpn"), nodeOf(hybrid, "api")];
		expect(vpn.x + vpn.width).toBeLessThan(api.x);
	});

	// Each ran 3.4:1 to 8.1:1 in one row or column. The four-deep zones' second
	// availability zone hangs under the first, the load balancer's line to it
	// skipping the first's ranks.
	it.each([
		["aws-three-tier", "LR", 2.45],
		["aws-three-tier", "RL", 2.45],
		["kubernetes-cluster", "LR", 2.45],
		["hybrid-cloud", "LR", 2.45],
		["hybrid-cloud", "RL", 2.45],
		["depth-four", "LR", 2.45],
		["depth-four", "TB", 2.45],
	] as const)(
		"wraps %s %s, too long for one row or column, in the stated direction",
		(name, direction, below) => {
			const scene = rendered(name, direction);
			expect(drawnAspect(scene)).toBeLessThan(below);
			expect(zoneRegionIssues(scene, fixtures[name]!)).toEqual([]);
			// Each step a line joins in the same row (or column) lies ahead of the step it leaves.
			const across = direction === "LR" || direction === "RL" ? "y" : "x";
			const size = across === "y" ? "height" : "width";
			const along = across === "y" ? "x" : "y";
			const forward = direction === "LR" || direction === "TB" ? 1 : -1;
			for (const edge of fixtures[name]!.edges) {
				const [source, target] = [nodeOf(scene, edge.source), nodeOf(scene, edge.target)];
				const level =
					Math.abs(source[across] + source[size] / 2 - (target[across] + target[size] / 2)) < 1;
				if (level) expect(forward * (target[along] - source[along])).toBeGreaterThan(0);
			}
		},
	);

	it("runs a flow straight through nested zones: each zone sits by its members", () => {
		// The order API sits two zones deeper than the queue it feeds, the ingress
		// controller two deeper than the client, the load balancer three deeper than
		// the users; no line jogs.
		const straight = (scene: RenderedDiagramScene, source: string, target: string) =>
			scene.elements.find(
				(e) => e.type === "arrow" && e.sourceNodeId === source && e.targetNodeId === target,
			)!;
		for (const [name, source, target] of [
			["hybrid-cloud", "api", "orders"],
			["kubernetes-cluster", "client", "ingress"],
			["aws-three-tier", "users", "alb"],
		] as const) {
			const arrow = straight(rendered(name, "LR"), source, target);
			expect(arrow.type === "arrow" && arrow.points.length).toBe(2);
		}
	});

	it("keeps a loop back into a zone short: the step it feeds sits beside the one that leaves", () => {
		const scene = rendered("kubernetes-cluster");
		const [api, worker] = [nodeOf(scene, "api-pods"), nodeOf(scene, "worker")];
		expect(worker.y).toBe(api.y);
		// The queue sits under the workers it feeds, the database under the API pods.
		const [queue, db] = [nodeOf(scene, "queue"), nodeOf(scene, "db")];
		expect(Math.abs(queue.x + queue.width / 2 - (worker.x + worker.width / 2))).toBeLessThan(
			Math.abs(db.x + db.width / 2 - (worker.x + worker.width / 2)),
		);
	});

	it("never runs a route along a node's border among zones", () => {
		const along: string[] = [];
		for (const name of Object.keys(fixtures))
			for (const direction of directions) {
				const scene = rendered(name, direction);
				const nodes = scene.elements.filter(
					(e): e is NodeSceneElement => e.type === "node" && e.rendererRole === undefined,
				);
				for (const arrow of scene.elements)
					if (arrow.type === "arrow")
						for (const [index, point] of arrow.points.slice(1).entries()) {
							const from = arrow.points[index]!;
							for (const node of nodes) {
								if (node.nodeId === arrow.sourceNodeId || node.nodeId === arrow.targetNodeId)
									continue;
								const horizontal = from.y === point.y;
								const [at, low, high, start, end] = horizontal
									? [from.y, node.y, node.y + node.height, node.x, node.x + node.width]
									: [from.x, node.x, node.x + node.width, node.y, node.y + node.height];
								const [min, max] = horizontal
									? [Math.min(from.x, point.x), Math.max(from.x, point.x)]
									: [Math.min(from.y, point.y), Math.max(from.y, point.y)];
								if (
									(Math.abs(at - low) < 0.01 || Math.abs(at - high) < 0.01) &&
									Math.min(max, end) - Math.max(min, start) > 0.01
								)
									along.push(`${name} ${direction} ${arrow.id} along ${node.id}`);
							}
						}
			}
		expect(along).toEqual([]);
	});

	it("draws each infrastructure shape with its label clear of the shape's curves", () => {
		const scene = rendered("hybrid-cloud");
		expect(nodeOf(scene, "oracle").shape).toBe("cylinder");
		expect(nodeOf(scene, "orders").shape).toBe("pipe");
		expect(nodeOf(scene, "invoice").shape).toBe("document");
		expect(nodeOf(rendered("aws-three-tier"), "s3").shape).toBe("bucket");
		for (const id of ["oracle", "orders", "invoice"]) {
			const node = nodeOf(scene, id);
			const box = canvasBoundTextBox(node);
			expect(box.height).toBeGreaterThanOrEqual(19);
			expect(box.width).toBeGreaterThanOrEqual(80);
		}
		// A cylinder's text box starts below its lid; a bucket's also clears its tapered sides.
		expect(canvasBoundTextBox(nodeOf(scene, "oracle")).height).toBe(
			nodeOf(scene, "oracle").height - 10 - 4 * CANVAS_SHAPE_CURVE.cylinder,
		);
		const bucket = nodeOf(rendered("aws-three-tier"), "s3");
		expect(canvasBoundTextBox(bucket).width).toBe(
			bucket.width - 10 - 2 * Math.round(bucket.width * 0.08),
		);
	});

	it("ends every line on a composed shape's drawn outline, not its box", () => {
		const off: string[] = [];
		// Each shape on every side: a line in from each direction to a bucket, a
		// pipe, a document and a cylinder, besides the fixtures.
		const shapes = parseFlowchartDiagram({
			id: "shapes",
			title: "Shapes",
			type: "flowchart",
			nodes: [
				{ id: "a", label: "API service", kind: "start" },
				{ id: "b", label: "Assets bucket", kind: "process", shape: "storage" },
				{ id: "q", label: "Jobs queue", kind: "process", shape: "queue" },
				{ id: "d", label: "Invoice archive", kind: "process", shape: "document" },
				{ id: "c", label: "Orders database", kind: "end", shape: "database" },
			],
			edges: [
				{ id: "ab", source: "a", target: "b" },
				{ id: "bq", source: "b", target: "q" },
				{ id: "qd", source: "q", target: "d" },
				{ id: "dc", source: "d", target: "c" },
				{ id: "ac", source: "a", target: "c" },
			],
		});
		for (const [name, fixture] of [...Object.entries(fixtures), ["shapes", shapes] as const])
			for (const direction of directions) {
				const scene = rendered(name === "shapes" ? "shapes" : name, direction, fixture);
				const nodes = new Map(
					scene.elements.flatMap((e) => (e.type === "node" ? [[e.nodeId, e] as const] : [])),
				);
				for (const arrow of scene.elements) {
					if (arrow.type !== "arrow") continue;
					for (const [id, point] of [
						[arrow.sourceNodeId, arrow.points[0]],
						[arrow.targetNodeId, arrow.points.at(-1)!],
					] as const) {
						const node = nodes.get(id)!;
						if (!isCanvasComposedShape(node.shape)) continue;
						const outline = canvasShapeOutline({ ...node, shape: node.shape });
						const distance = Math.min(
							...outline.slice(1).map((to, index) => {
								const from = outline[index]!;
								const [dx, dy] = [to.x - from.x, to.y - from.y];
								const t = Math.max(
									0,
									Math.min(
										1,
										((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy || 1),
									),
								);
								return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
							}),
						);
						if (distance > 1)
							off.push(`${name} ${direction} ${arrow.id} ${node.shape} ${distance.toFixed(1)}`);
					}
				}
			}
		expect(off).toEqual([]);
	});

	it("keeps a logo on an infrastructure shape below its lid", () => {
		const fixture = parseFlowchartDiagram({
			...zoneFixtures["aws-three-tier"],
			nodes: zoneFixtures["aws-three-tier"].nodes.map((node) =>
				node.id === "rds" ? { ...node, icon: { slug: "postgresql" } } : node,
			),
		});
		const scene = renderIntermediateDiagram(fixture);
		const rds = nodeOf(scene, "rds");
		const icon = canvasNodeIconBox(rds)!;
		expect(icon.y).toBeGreaterThanOrEqual(rds.y + 2 * CANVAS_SHAPE_CURVE.cylinder);
		expect(
			getCanvasValidationIssues({
				...scene,
				icons: { postgresql: { name: "PostgreSQL", svg: "<svg/>" } },
			}),
		).toEqual([]);
	});

	it("keeps flat groups without a kind as frames", () => {
		const scene = renderIntermediateDiagram(groupFixtures["grouped-approval"]);
		expect(scene.elements.some((e) => e.type === "frame")).toBe(true);
		expect(zonesOf(scene)).toEqual([]);
	});
});

describe("lines into a hanging zone band", () => {
	const arrowOf = (scene: RenderedDiagramScene, edgeId: string) =>
		scene.elements.find((e) => e.type === "arrow" && e.edgeId === edgeId)!;
	// Corners only: a point where a run continues straight on is no turn.
	const turns = (scene: RenderedDiagramScene, edgeId: string) => {
		const arrow = arrowOf(scene, edgeId);
		if (arrow.type !== "arrow") return -1;
		const horizontal = arrow.points
			.slice(1)
			.map((point, index) => Math.abs(point.y - arrow.points[index]!.y) < 0.01);
		return horizontal.slice(1).filter((run, index) => run !== horizontal[index]).length;
	};

	it("reaches a step behind another of its rank around that step", () => {
		// Round 19, Sonnet: the orders table hangs straight under the sync
		// function and the invoice archive under the table. Both lines hooked
		// around the region's margin, four turns each.
		const scene = rendered("hybrid-cloud-labeled", "LR");
		expect(turns(scene, "edge-7")).toBe(0);
		expect(turns(scene, "edge-8")).toBeLessThanOrEqual(2);
		const sync = nodeOf(scene, "sync");
		const archive = nodeOf(scene, "arc");
		const toArchive = arrowOf(scene, "edge-8");
		// The archive's line leaves forward and turns back into its forward side.
		expect(toArchive.type === "arrow" && toArchive.points[0].x).toBe(sync.x + sync.width);
		expect(toArchive.type === "arrow" && toArchive.points.at(-1)!.x).toBe(
			archive.x + archive.width,
		);
	});

	it("keeps the data center beside the cloud when its region wraps clear of crossings", () => {
		// A Sol sample stacked the cloud under the data center: its region's
		// side-by-side wrap crossed the ERP's two lines over the Oracle database.
		const scene = renderIntermediateDiagram(describedHybridFlowchart);
		const zones = new Map(zonesOf(scene).map((zone) => [zone.nodeId, zone]));
		const [dc, aws] = [zones.get("group:dc")!, zones.get("group:aws")!];
		expect(aws.x).toBeGreaterThan(dc.x + dc.width);
		expect(dc.y).toBeLessThan(aws.y + aws.height);
	});

	it.each(["LR", "RL"] as const)(
		"keeps the cloud beside the data center it follows in a %s row",
		(direction) => {
			// Two of three Sol samples asked for left to right hung the cloud under the
			// data center: a top-level wrap came within the target aspect in two bands,
			// the region's wrap inside the cloud in three, and the fewer bands won. The
			// ERP's line ran down and back against the row to the VPN gateway.
			const scene = renderIntermediateDiagram({
				...leftToRightHybridFlowchart,
				layout: { direction, edgeRouting: "orthogonal" },
			});
			const zones = new Map(zonesOf(scene).map((zone) => [zone.nodeId, zone]));
			const [dc, aws] = [zones.get("group:dc")!, zones.get("group:aws")!];
			const forward = direction === "LR" ? 1 : -1;
			const [erp, vpn] = [nodeOf(scene, "erp"), nodeOf(scene, "vpn")];
			if (direction === "LR") expect(aws.x).toBeGreaterThan(dc.x + dc.width);
			else expect(dc.x).toBeGreaterThan(aws.x + aws.width);
			expect(forward * (vpn.x - erp.x)).toBeGreaterThan(0);
			expect(drawnAspect(scene)).toBeLessThan(2.45);
		},
	);

	it.each(
		Object.keys(requestPathFlowcharts).flatMap((name) =>
			(["LR", "RL"] as const).map((direction) => [name, direction] as const),
		),
	)("keeps the public internet beside the DMZ in %s, asked for %s", (name, direction) => {
		// Asked for left to right, a Sol sample stacked all three zones: two bands
		// missed the 2:1 target, so three did. Sonnet samples hung the DMZ under
		// the public internet: the cached page's line to the response skipped the
		// private subnet, which barred the cut after the DMZ. One zone at most now
		// hangs under the DMZ, the request passing from each zone to the next.
		const fixture = fixtures[name]!;
		const scene = rendered(name, direction);
		const zones = new Map(zonesOf(scene).map((zone) => [zone.nodeId, zone]));
		const [internet, dmz] = fixture.groups!.map((group) => zones.get(`group:${group.id}`)!);
		const [first, second] = direction === "LR" ? [internet!, dmz!] : [dmz!, internet!];
		expect(first.x + first.width).toBeLessThan(second.x);
		expect(internet!.y).toBeLessThan(dmz!.y + dmz!.height);
		expect(dmz!.y).toBeLessThan(internet!.y + internet!.height);
		expect(drawnAspect(scene)).toBeLessThan(2.45);
	});

	it("keeps the data center beside the cloud when a side change clears its region's wrap of crossings", () => {
		// A Sol sample stacked the cloud under the data center: beside it, its
		// region's wrap crossed the sync function's lines to the table and the
		// PDF once, which the crossing repairs remove.
		const scene = renderIntermediateDiagram(stackedHybridFlowchart);
		const zones = new Map(zonesOf(scene).map((zone) => [zone.nodeId, zone]));
		const [dc, aws] = [zones.get("group:dc")!, zones.get("group:aws")!];
		expect(aws.x).toBeGreaterThan(dc.x + dc.width);
		expect(dc.y).toBeLessThan(aws.y + aws.height);
		expect(arrowCrossings(scene.elements.flatMap((e) => (e.type === "arrow" ? [e] : [])))).toBe(0);
	});
});

describe("lines past an infrastructure shape", () => {
	/** Room every line keeps from the drawn outline of a node it neither leaves nor enters. */
	const NODE_CLEARANCE = 12;
	type Point = { readonly x: number; readonly y: number };
	// A composed shape's curves and sides, an ellipse finely sampled, or a box.
	const outline = (node: NodeSceneElement): Point[] => {
		if (isCanvasComposedShape(node.shape))
			return canvasShapeOutline({ ...node, shape: node.shape });
		const [cx, cy, rx, ry] = [node.width / 2, node.height / 2, node.width / 2, node.height / 2];
		if (node.shape === "ellipse" || node.shape === "circle")
			return Array.from({ length: 361 }, (_, i) => ({
				x: node.x + cx + rx * Math.cos((i * Math.PI) / 180),
				y: node.y + cy + ry * Math.sin((i * Math.PI) / 180),
			}));
		return [
			{ x: node.x, y: node.y },
			{ x: node.x + node.width, y: node.y },
			{ x: node.x + node.width, y: node.y + node.height },
			{ x: node.x, y: node.y + node.height },
			{ x: node.x, y: node.y },
		];
	};
	const toSegment = (p: Point, a: Point, b: Point) => {
		const [dx, dy] = [b.x - a.x, b.y - a.y];
		const t = Math.max(
			0,
			Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
		);
		return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
	};
	const gap = (a: Point, b: Point, c: Point, d: Point) => {
		const side = (o: Point, p: Point, q: Point) =>
			(p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
		if (side(c, d, a) * side(c, d, b) < 0 && side(a, b, c) * side(a, b, d) < 0) return 0;
		return Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b));
	};

	it.each(Object.keys(bypassingHybridFlowcharts))(
		"keeps each line of %s clear of the shapes it passes",
		(name) => {
			// Two Sonnet samples ran the ERP's line to the VPN gateway along the
			// Oracle database's foot: the line cleared the database's side by the
			// node clearance, then ran on just under its foot.
			const scene = renderIntermediateDiagram(
				bypassingHybridFlowcharts[name as keyof typeof bypassingHybridFlowcharts],
			);
			const nodes = scene.elements.filter(
				(e): e is NodeSceneElement => e.type === "node" && e.rendererRole === undefined,
			);
			const close = scene.elements.flatMap((arrow) =>
				arrow.type !== "arrow"
					? []
					: nodes.flatMap((node) => {
							if (node.nodeId === arrow.sourceNodeId || node.nodeId === arrow.targetNodeId)
								return [];
							const polygon = outline(node);
							const least = Math.min(
								...arrow.points
									.slice(1)
									.flatMap((to, index) =>
										polygon
											.slice(1)
											.map((end, at) => gap(arrow.points[index]!, to, polygon[at]!, end)),
									),
							);
							return least < NODE_CLEARANCE
								? [`${arrow.edgeId} ${least.toFixed(1)} px from ${node.nodeId}`]
								: [];
						}),
			);
			expect(close).toEqual([]);
		},
	);

	// Every zone fixture and generated sample, in every direction, and the
	// four-deep zones, wrapped where too long for one row. Thirty services stay
	// out: they pass a flowchart's limits.
	const samples: Record<string, IntermediateDiagram> = {
		...zoneFixtures,
		...requestPathFlowcharts,
		"depth-four": zoneStressFixtures["depth-four"],
		...bypassingHybridFlowcharts,
		"hybrid-cloud-archive-corridor": corridorHybridFlowchart,
		"hybrid-cloud-described": describedHybridFlowchart,
		"hybrid-cloud-left-to-right": leftToRightHybridFlowchart,
		"hybrid-cloud-stacked": stackedHybridFlowchart,
		"hybrid-cloud-sync": syncedHybridFlowchart,
		"aws-three-tier-described": describedArchitectureFlowchart,
		"aws-three-tier-queries": queriedArchitectureFlowchart,
		"aws-three-tier-requests": requestedArchitectureFlowchart,
	};
	it.each(Object.keys(samples))(
		"runs no line of %s alongside a node it passes, nearer than two lines read apart",
		(name) => {
			// Sol and Sonnet hybrid samples ran the ERP's line to the VPN gateway 13
			// units under the Oracle database's foot, between it and the data
			// center's outline, which reads as touching it at the reader's scale.
			const along: string[] = [];
			for (const direction of directions) {
				const scene = renderIntermediateDiagram({
					...samples[name]!,
					layout: { direction, edgeRouting: "orthogonal" },
				});
				const nodes = scene.elements.filter(
					(e): e is NodeSceneElement => e.type === "node" && e.rendererRole === undefined,
				);
				const points = scene.elements.flatMap((e) =>
					e.type === "arrow"
						? e.points
						: e.type === "node"
							? [
									{ x: e.x, y: e.y },
									{ x: e.x + e.width, y: e.y + e.height },
								]
							: [],
				);
				const [xs, ys] = [points.map((point) => point.x), points.map((point) => point.y)];
				const scale = routingQualityScale({
					width: Math.max(...xs) - Math.min(...xs),
					height: Math.max(...ys) - Math.min(...ys),
				});
				const [corridor, run] = [routingCorridorGap(scale), routingCorridorRun(scale)];
				for (const arrow of scene.elements) {
					if (arrow.type !== "arrow") continue;
					for (const [index, to] of arrow.points.slice(1).entries()) {
						const from = arrow.points[index]!;
						const horizontal = Math.abs(from.y - to.y) < 0.01;
						for (const node of nodes) {
							if (node.nodeId === arrow.sourceNodeId || node.nodeId === arrow.targetNodeId)
								continue;
							const [at, low, high, start, end] = horizontal
								? [from.y, node.y, node.y + node.height, node.x, node.x + node.width]
								: [from.x, node.x, node.x + node.width, node.y, node.y + node.height];
							const [min, max] = horizontal
								? [Math.min(from.x, to.x), Math.max(from.x, to.x)]
								: [Math.min(from.y, to.y), Math.max(from.y, to.y)];
							const distance = at < low ? low - at : at - high;
							if (
								distance > 0 &&
								distance < corridor &&
								Math.min(max, end) - Math.max(min, start) > run
							)
								along.push(
									`${direction} ${arrow.edgeId} ${distance.toFixed(1)} from ${node.nodeId}`,
								);
						}
					}
				}
			}
			expect(along).toEqual([]);
		},
	);
});

describe("line ends from generated samples", () => {
	type Point = { readonly x: number; readonly y: number };
	const arrow = (scene: RenderedDiagramScene, edgeId: string) => {
		const found = scene.elements.find((e) => e.type === "arrow" && e.edgeId === edgeId);
		if (found?.type !== "arrow") throw new Error(`No arrow for ${edgeId}`);
		return found;
	};
	const node = (scene: RenderedDiagramScene, nodeId: string) => {
		const found = scene.elements.find((e) => e.type === "node" && e.nodeId === nodeId);
		if (found?.type !== "node") throw new Error(`No node ${nodeId}`);
		return found;
	};
	// The points where a line turns.
	const turns = (points: readonly Point[]) =>
		points.filter((point, index) => {
			const [before, after] = [points[index - 1], points[index + 1]];
			return (
				!before ||
				!after ||
				!(
					(before.x === point.x && point.x === after.x) ||
					(before.y === point.y && point.y === after.y)
				)
			);
		});

	it("lands the users' requests away from the load balancer's corner, past the subnet's name", () => {
		// The drop into the middle meets the public subnet's name, so the line
		// once took the far end of the top instead, beside the rounded corner.
		const scene = renderIntermediateDiagram(requestedArchitectureFlowchart);
		const alb = node(scene, "alb");
		const end = arrow(scene, "edge-1").points.at(-1)!;
		expect(end.y).toBe(alb.y);
		expect(Math.abs(end.x - alb.x - alb.width / 2)).toBeLessThanOrEqual((3 / 4) * (alb.width / 2));
	});

	it("runs the sync function's line straight into the archive's side across the free corridor", () => {
		// The line left the sync function just above the archive's span, rose
		// over its corner and hooked down into its top.
		const scene = renderIntermediateDiagram(corridorHybridFlowchart);
		const archive = node(scene, "archive");
		const { points } = arrow(scene, "edge-8");
		expect(turns(points)).toHaveLength(2);
		expect(points.at(-1)!.y).toBeGreaterThan(archive.y);
		expect(points.at(-1)!.y).toBeLessThan(archive.y + archive.height);
		expect(points.at(-1)!.x).toBeLessThan(archive.x + archive.width / 2);
	});

	it("runs each of the hybrid sample's lines straight past a jog's reach of either end", () => {
		// The sync function's lines to the table and the archive held their
		// labels' room on the first run and stepped sideways just before the head.
		const scene = renderIntermediateDiagram(syncedHybridFlowchart);
		// Judged at the size of what is drawn: nodes, zones and lines.
		const [xs, ys] = (["x", "y"] as const).map((axis) =>
			scene.elements.flatMap((e) =>
				e.type === "arrow"
					? e.points.map((point) => point[axis])
					: e.type === "node"
						? [e[axis], e[axis] + (axis === "x" ? e.width : e.height)]
						: [],
			),
		);
		const scale = routingQualityScale({
			width: Math.max(...xs!) - Math.min(...xs!),
			height: Math.max(...ys!) - Math.min(...ys!),
		});
		const [reach, wide] = [routingJogReach(scale), routingWideBend(scale)];
		const jogs = scene.elements.flatMap((element) => {
			if (element.type !== "arrow" || element.sourceNodeId === element.targetNodeId) return [];
			const points = turns(element.points);
			const [start, end] = [points[0]!, points.at(-1)!];
			return points.slice(1, -2).flatMap((from, index) => {
				const [before, to, after] = [points[index]!, points[index + 2]!, points[index + 3]!];
				const heading = (a: Point, b: Point) => [Math.sign(b.x - a.x), Math.sign(b.y - a.y)].join();
				return heading(before, from) === heading(to, after) &&
					Math.hypot(to.x - from.x, to.y - from.y) < wide &&
					(Math.hypot(end.x - to.x, end.y - to.y) <= reach ||
						Math.hypot(from.x - start.x, from.y - start.y) <= reach)
					? [element.edgeId]
					: [];
			});
		});
		expect(jogs).toEqual([]);
	});
});
