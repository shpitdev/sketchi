import { describe, expect, it } from "vitest";

import {
	type AxisAlignedSegment,
	erFixture,
	erStressFixtures,
	getCanvasValidationIssues,
	orgChartEr,
	parseErDiagram,
	parseErFieldShorthand,
	segmentCrossesBoundsInterior,
	segmentsFromPoints,
} from "@sketchi/diagram-core";

import { renderDiagram } from "../diagram.js";
import type { ArrowSceneElement, NodeSceneElement, RenderedDiagramScene } from "../scene.js";

const nodes = (scene: RenderedDiagramScene) =>
	scene.elements.flatMap((element) => (element.type === "node" ? [element] : []));
const arrows = (scene: RenderedDiagramScene) =>
	scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : []));
const text = (scene: RenderedDiagramScene, id: string) =>
	scene.elements.find((element) => element.type === "text" && element.id === id);
const table = (scene: RenderedDiagramScene, id: string) =>
	nodes(scene).find((node) => node.id === `node:${id}`)!;
const arrow = (scene: RenderedDiagramScene, id: string) =>
	arrows(scene).find((candidate) => candidate.edgeId === id)!;

/** Where a field's row meets its table's side: 40 for the name band, 6 above the rows, 28 a row. */
function rowY(box: NodeSceneElement, row: number): number {
	return box.y + 40 + 6 + (row + 0.5) * 28;
}

function endOn(
	box: NodeSceneElement,
	point: { x: number; y: number },
): "left" | "right" | undefined {
	if (Math.abs(point.x - box.x) < 0.01) return "left";
	if (Math.abs(point.x - box.x - box.width) < 0.01) return "right";
	return undefined;
}

/** How far two segments run along one line together. */
function overlap(a: AxisAlignedSegment, b: AxisAlignedSegment): number {
	return a.orientation === b.orientation && Math.abs(a.staticCoordinate - b.staticCoordinate) < 0.01
		? Math.min(a.max, b.max) - Math.max(a.min, b.min)
		: 0;
}

const orthogonal = (line: ArrowSceneElement) =>
	line.points.every(
		(point, index) =>
			index === 0 ||
			Math.abs(point.x - line.points[index - 1]!.x) < 0.01 ||
			Math.abs(point.y - line.points[index - 1]!.y) < 0.01,
	);

/** Interior crossings between lines: a horizontal run of one crossing a vertical run of another. */
function crossings(lines: readonly ArrowSceneElement[]): number {
	const runs = lines.map((line) => segmentsFromPoints(line.points));
	let count = 0;
	for (const [index, segments] of runs.entries())
		for (const others of runs.slice(index + 1))
			for (const a of segments)
				for (const b of others) {
					if (a.orientation === b.orientation) continue;
					const [h, v] = a.orientation === "horizontal" ? [a, b] : [b, a];
					if (
						v.staticCoordinate > h.min + 0.01 &&
						v.staticCoordinate < h.max - 0.01 &&
						h.staticCoordinate > v.min + 0.01 &&
						h.staticCoordinate < v.max - 0.01
					)
						count += 1;
				}
	return count;
}

/**
 * Neighboring ends on one side of a table whose heads touch: Excalidraw draws
 * a bar or foot 17 across, so two ports nearer than 20 run them together.
 */
function bunchedEnds(scene: RenderedDiagramScene): number {
	const sides = new Map<string, number[]>();
	for (const line of arrows(scene))
		for (const [node, point] of [
			[line.sourceNodeId, line.points[0]],
			[line.targetNodeId, line.points.at(-1)!],
		] as const) {
			const key = `${node}:${Math.round(point.x)}`;
			sides.set(key, [...(sides.get(key) ?? []), point.y]);
		}
	return [...sides.values()].reduce((sum, ports) => {
		ports.sort((a, b) => a - b);
		return sum + ports.slice(1).filter((port, index) => port - ports[index]! < 20).length;
	}, 0);
}

/** Ends that leave their table on the side away from a table in another column. */
function wraps(scene: RenderedDiagramScene): number {
	let count = 0;
	for (const line of arrows(scene)) {
		const [source, target] = [table(scene, line.sourceNodeId), table(scene, line.targetNodeId)];
		if (source.x < target.x + target.width && target.x < source.x + source.width) continue;
		for (const [tip, next, other] of [
			[line.points[0], line.points[1]!, line.points.at(-1)!],
			[line.points.at(-1)!, line.points.at(-2)!, line.points[0]],
		] as const)
			if ((next.x - tip.x) * (other.x - tip.x) < 0) count += 1;
	}
	return count;
}

/**
 * Ends whose bar or foot another line's stem runs through, other than a
 * neighbor's on the same row: Excalidraw draws each head min(20, run / 2)
 * long and 20 sin 25° either side of its line. A row holding more ends than
 * its band spaces a mark apart may still bunch them; no line from another
 * row, or passing by, may cross a mark.
 */
function foreignMarks(scene: RenderedDiagramScene): string[] {
	const lines = arrows(scene);
	const rowAt = (node: string, y: number) => {
		const box = table(scene, node);
		return y - box.y < 40 ? -1 : Math.floor((y - box.y - 46) / 28);
	};
	return lines.flatMap((line) =>
		(
			[
				[line.points[0], line.points[1]!, line.sourceNodeId],
				[line.points.at(-1)!, line.points.at(-2)!, line.targetNodeId],
			] as const
		).flatMap(([tip, next, node]) => {
			const run = Math.hypot(next.x - tip.x, next.y - tip.y);
			const size = Math.min(20, run / 2);
			const reach = size * Math.sin((25 * Math.PI) / 180);
			const [dx, dy] = [(next.x - tip.x) / run, (next.y - tip.y) / run];
			const box = {
				x0: Math.min(tip.x, tip.x + dx * size) - Math.abs(dy) * reach,
				x1: Math.max(tip.x, tip.x + dx * size) + Math.abs(dy) * reach,
				y0: Math.min(tip.y, tip.y + dy * size) - Math.abs(dx) * reach,
				y1: Math.max(tip.y, tip.y + dy * size) + Math.abs(dx) * reach,
			};
			return lines.flatMap((other) => {
				if (other === line) return [];
				const neighbor = [
					[other.points[0], other.sourceNodeId],
					[other.points.at(-1)!, other.targetNodeId],
				].some(
					([point, otherNode]) =>
						otherNode === node &&
						Math.abs((point as typeof tip).x - tip.x) < 0.5 &&
						rowAt(node, (point as typeof tip).y) === rowAt(node, tip.y),
				);
				const crosses = segmentsFromPoints(other.points).some((segment) =>
					segment.orientation === "horizontal"
						? segment.max > box.x0 + 0.01 &&
							segment.min < box.x1 - 0.01 &&
							segment.staticCoordinate > box.y0 + 0.01 &&
							segment.staticCoordinate < box.y1 - 0.01
						: segment.max > box.y0 + 0.01 &&
							segment.min < box.y1 - 0.01 &&
							segment.staticCoordinate > box.x0 + 0.01 &&
							segment.staticCoordinate < box.x1 - 0.01,
				);
				return crosses && !neighbor ? [`${line.edgeId} at ${node} under ${other.edgeId}`] : [];
			});
		}),
	);
}

const aspectOf = (scene: RenderedDiagramScene) =>
	Math.max(scene.width / scene.height, scene.height / scene.width);

/**
 * Each field's text line from its table's top, read off the drawn field
 * names: one text per column holds every row 28 apart, or, where a row grew,
 * one text per row stands at that row's middle.
 */
function fieldLines(scene: RenderedDiagramScene, id: string): number[] {
	const box = table(scene, id);
	const column = text(scene, `text:${id}:fields`);
	if (column?.type === "text")
		return column.text.split("\n").map((_, row) => rowY(box, row) - box.y);
	const lines: number[] = [];
	for (let row = 0; ; row += 1) {
		const cell = text(scene, `text:${id}:fields:${row}`);
		if (cell?.type !== "text") return lines;
		lines.push(cell.y - box.y);
	}
}

/** The tinted band behind a grown row, from its table's top and sides. */
function keyBand(scene: RenderedDiagramScene, id: string, row: number) {
	const box = table(scene, id);
	const band = nodes(scene).find((node) => node.id === `node:${id}:row:${row}`);
	return band
		? {
				left: band.x - box.x,
				right: box.x + box.width - (band.x + band.width),
				top: band.y - box.y,
				bottom: band.y + band.height - box.y,
				fill: band.fillColor,
			}
		: undefined;
}

/** Sonnet's saas-workspace-er s5 in round 24, as the model wrote it: five lines end on organizations.id. */
const saasWorkspaceS5 = parseErDiagram({
	id: "saas-workspace-database",
	title: "SaaS Workspace Database",
	type: "er",
	entities: (
		[
			["organizations", ["id uuid PK", "name text"]],
			["users", ["id uuid PK", "email text UK", "name text"]],
			["memberships", ["organization_id uuid PK FK", "user_id uuid PK FK", "role text"]],
			["projects", ["id uuid PK", "organization_id uuid FK", "name text"]],
			[
				"tasks",
				["id uuid PK", "project_id uuid FK", "assignee_id uuid? FK", "title text", "due_on date?"],
			],
			["comments", ["id uuid PK", "task_id uuid FK", "author_id uuid FK", "body text"]],
			["labels", ["id uuid PK", "organization_id uuid FK", "name text"]],
			["task_labels", ["task_id uuid PK FK", "label_id uuid PK FK"]],
			["plans", ["id uuid PK", "name text UK", "monthly_price numeric"]],
			[
				"subscriptions",
				["id uuid PK", "organization_id uuid FK UK", "plan_id uuid FK", "renews_on date"],
			],
			[
				"invoices",
				["id uuid PK", "subscription_id uuid FK", "amount numeric", "paid_at timestamptz?"],
			],
			[
				"api_keys",
				["id uuid PK", "organization_id uuid FK", "created_by uuid FK", "token_hash text UK"],
			],
		] as const
	).map(([id, fields]) => ({ id, fields: fields.map(parseErFieldShorthand) })),
	relationships: (
		[
			["memberships.organization_id", "organizations.id", "one-or-many", "one"],
			["memberships.user_id", "users.id", "zero-or-many", "one"],
			["projects.organization_id", "organizations.id", "zero-or-many", "one"],
			["labels.organization_id", "organizations.id", "zero-or-many", "one"],
			["api_keys.organization_id", "organizations.id", "zero-or-many", "one"],
			["tasks.project_id", "projects.id", "zero-or-many", "one"],
			["tasks.assignee_id", "users.id", "zero-or-many", "zero-or-one"],
			["comments.task_id", "tasks.id", "zero-or-many", "one"],
			["comments.author_id", "users.id", "zero-or-many", "one"],
			["task_labels.task_id", "tasks.id", "zero-or-many", "one"],
			["task_labels.label_id", "labels.id", "zero-or-many", "one"],
			["subscriptions.organization_id", "organizations.id", "zero-or-one", "one"],
			["subscriptions.plan_id", "plans.id", "zero-or-many", "one"],
			["invoices.subscription_id", "subscriptions.id", "zero-or-many", "one"],
			["api_keys.created_by", "users.id", "zero-or-many", "one"],
		] as const
	).map(([from, to, fromCardinality, toCardinality], index) => ({
		id: `relationship-${index + 1}`,
		from,
		to,
		fromCardinality,
		toCardinality,
	})),
	style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
});

/** Sol's preview s4 in the #540 A/B: s5's schema, titled anew, with three relationships labeled. */
const saasWorkspaceLabeled = parseErDiagram({
	...saasWorkspaceS5,
	title: "SaaS workspace database",
	relationships: saasWorkspaceS5.relationships.map((relationship) => {
		const label = {
			"relationship-7": "assignee",
			"relationship-9": "author",
			"relationship-15": "created by",
		}[relationship.id];
		return label ? { ...relationship, label } : relationship;
	}),
});

describe("ER renderer", () => {
	it("renders every fixture into a valid deterministic scene", () => {
		for (const diagram of [erFixture, orgChartEr, ...Object.values(erStressFixtures)]) {
			const scene = renderDiagram(diagram);
			expect(scene.diagramId).toBe(diagram.id);
			expect(getCanvasValidationIssues(scene)).toEqual([]);
			expect(renderDiagram(diagram)).toEqual(scene);
		}
	});

	it("draws each entity as a table: a name band over key, field and type columns", () => {
		const scene = renderDiagram(erFixture);
		const orders = table(scene, "orders");
		expect(orders).toMatchObject({
			rendererRole: "er-table",
			label: "orders",
			groupIds: ["table:orders"],
		});
		expect(nodes(scene).find((node) => node.id === "node:orders:header")).toMatchObject({
			rendererRole: "er-table",
			x: orders.x,
			y: orders.y,
			width: orders.width,
			height: 40,
		});
		expect(text(scene, "label:orders:header")).toMatchObject({ text: "orders" });
		expect(text(scene, "text:orders:keys")).toMatchObject({ text: "PK\nFK\n\n", lineHeight: 2 });
		expect(text(scene, "text:orders:fields")).toMatchObject({
			text: "id\ncustomer_id\nplaced_at\nshipped_at",
			textAlign: "left",
		});
		// A nullable field reads `type?`.
		expect(text(scene, "text:orders:types")).toMatchObject({
			text: "uuid\nuuid\ntimestamptz\ntimestamptz?",
		});
		expect(text(scene, "text:order_items:keys")).toMatchObject({ text: "PK FK\nPK FK\n" });
		expect(orders.height).toBe(40 + 12 + 4 * 28);
	});

	it("ends each relationship at the rows it joins, in its cardinality's crow's-foot head", () => {
		const scene = renderDiagram(erFixture);
		const places = arrow(scene, "places");
		const [customers, orders] = [table(scene, "customers"), table(scene, "orders")];
		expect(places).toMatchObject({
			sourceNodeId: "customers",
			targetNodeId: "orders",
			startArrowhead: "crowfoot_one",
			endArrowhead: "crowfoot_many",
		});
		expect(places.points[0]).toMatchObject({
			x: customers.x + customers.width,
			y: rowY(customers, 0),
		});
		expect(places.points.at(-1)).toMatchObject({ x: orders.x, y: rowY(orders, 1) });
		expect(arrow(scene, "contains")).toMatchObject({
			startArrowhead: "crowfoot_one",
			endArrowhead: "crowfoot_one_or_many",
		});
		for (const line of arrows(scene)) expect(orthogonal(line), line.id).toBe(true);
	});

	it("rings an optional end on its own line, past its bar or foot, grouped with its table", () => {
		const scene = renderDiagram(erFixture);
		const rings = nodes(scene).filter((node) => node.rendererRole === "er-optional");
		// places and ordered-as are zero-or-many at their child ends; contains is one-or-many.
		expect(rings).toHaveLength(2);
		const tip = arrow(scene, "places").points.at(-1)!;
		const ring = rings.find((candidate) => candidate.groupIds?.includes("table:orders"))!;
		expect(ring).toMatchObject({ shape: "circle", width: 12, height: 12 });
		expect(ring.y + ring.height / 2).toBe(tip.y);
		expect(tip.x - (ring.x + ring.width / 2)).toBe(32);
	});

	it("draws a self-reference from the foreign key's row to the key's row on one side", () => {
		const scene = renderDiagram(orgChartEr);
		const employees = table(scene, "employees");
		const loop = arrow(scene, "reports-to");
		const [start, end] = [loop.points[0], loop.points.at(-1)!];
		expect(loop.sourceNodeId).toBe("employees");
		expect(loop.targetNodeId).toBe("employees");
		expect(endOn(employees, start)).toBeDefined();
		expect(endOn(employees, start)).toBe(endOn(employees, end));
		// The referenced key (id) leaves; the foreign key (manager_id) arrives.
		expect(start.y).toBe(rowY(employees, 0));
		expect(end.y).toBe(rowY(employees, 1));
		expect(loop).toMatchObject({ startArrowhead: "crowfoot_one", endArrowhead: "crowfoot_many" });
	});

	it("keeps a different head at a shared row on that row, at a port of its own", () => {
		const diagram = parseErDiagram({
			id: "posts",
			title: "Posts",
			type: "er",
			entities: [
				{ id: "users", fields: [{ name: "id", pk: true }] },
				{
					id: "posts",
					fields: [
						{ name: "author_id", fk: true },
						{ name: "editor_id", fk: true, nullable: true },
					],
				},
			],
			relationships: [
				{
					id: "wrote",
					from: "users.id",
					to: "posts.author_id",
					fromCardinality: "one",
					toCardinality: "zero-or-many",
				},
				{
					id: "edited",
					from: "users.id",
					to: "posts.editor_id",
					fromCardinality: "zero-or-one",
					toCardinality: "zero-or-many",
				},
			],
		});
		const scene = renderDiagram(diagram);
		const users = table(scene, "users");
		const [wrote, edited] = [arrow(scene, "wrote").points[0], arrow(scene, "edited").points[0]];
		// Both leave the id row, a row's height apart at most, not one stem.
		for (const start of [wrote, edited])
			expect(Math.abs(start.y - rowY(users, 0))).toBeLessThan(14);
		expect(wrote).not.toEqual(edited);
		// Only the optional end draws a ring, on its own line.
		const rings = nodes(scene).filter((node) => node.groupIds?.includes("table:users"));
		expect(rings.filter((node) => node.rendererRole === "er-optional")).toHaveLength(1);
		expect(rings.find((node) => node.rendererRole === "er-optional")!.y + 6).toBe(edited.y);
	});

	it("gives entity-level ends with different heads ports of their own in the name band", () => {
		const diagram = parseErDiagram({
			id: "owners",
			title: "Owners",
			type: "er",
			entities: [
				{ id: "accounts", fields: [{ name: "id", pk: true }] },
				{ id: "projects", fields: [{ name: "id", pk: true }] },
				{ id: "invites", fields: [{ name: "id", pk: true }] },
			],
			relationships: [
				{
					id: "owns",
					from: "projects",
					to: "accounts",
					fromCardinality: "many",
					toCardinality: "one",
				},
				{
					id: "sent",
					from: "invites",
					to: "accounts",
					fromCardinality: "many",
					toCardinality: "zero-or-one",
				},
			],
		});
		const scene = renderDiagram(diagram);
		const accounts = table(scene, "accounts");
		const [owns, sent] = [arrow(scene, "owns").points[0], arrow(scene, "sent").points[0]];
		for (const start of [owns, sent]) {
			expect(start.y).toBeGreaterThan(accounts.y);
			expect(start.y).toBeLessThan(accounts.y + 40);
		}
		expect(owns).not.toEqual(sent);
		const ring = nodes(scene).find(
			(node) => node.rendererRole === "er-optional" && node.groupIds?.includes("table:accounts"),
		)!;
		expect(ring.y + 6).toBe(sent.y);
	});

	it("never runs two relationship lines along one stretch", () => {
		for (const diagram of [erFixture, orgChartEr, ...Object.values(erStressFixtures)]) {
			const lines = arrows(renderDiagram(diagram));
			const shared = lines.flatMap((line, index) =>
				lines
					.slice(index + 1)
					.flatMap((other) =>
						segmentsFromPoints(line.points).some((a) =>
							segmentsFromPoints(other.points).some((b) => overlap(a, b) > 0.5),
						)
							? [`${diagram.id}: ${line.edgeId} and ${other.edgeId}`]
							: [],
					),
			);
			expect(shared).toEqual([]);
		}
	});

	it("attaches a field named with stray spaces at its row", () => {
		const diagram = parseErDiagram({
			id: "spaced",
			title: "Spaced",
			type: "er",
			entities: [
				{ id: "a", fields: [{ name: " id ", type: "int", pk: true }] },
				{
					id: "b",
					fields: [
						{ name: "id", type: "int", pk: true },
						{ name: "a_id", type: "int", fk: true },
					],
				},
			],
			relationships: [
				{
					id: "r",
					from: "b.a_id",
					to: "a.id",
					fromCardinality: "zero-or-many",
					toCardinality: "one",
				},
			],
		});
		const scene = renderDiagram(diagram);
		expect([scene.width, scene.height].every(Number.isFinite)).toBe(true);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		const a = table(scene, "a");
		expect(arrow(scene, "r").points[0]).toMatchObject({ x: a.x + a.width, y: rowY(a, 0) });
		expect(text(scene, "text:a:fields")).toMatchObject({ text: "id" });
	});

	it("keeps composite-key rows' ends a mark's reach apart, however many tables reference both", () => {
		for (const children of [2, 3, 4, 5]) {
			const diagram = parseErDiagram({
				id: `composite-${children}`,
				title: "Composite keys",
				type: "er",
				entities: [
					{
						id: "parent",
						fields: [
							{ name: "tenant_id", pk: true },
							{ name: "id", pk: true },
						],
					},
					...Array.from({ length: children }, (_, at) => ({
						id: `child${at}`,
						fields: [
							{ name: "tenant_id", fk: true },
							{ name: "parent_id", fk: true },
						],
					})),
				],
				relationships: Array.from({ length: children }, (_, at) => [
					{
						id: `tenant${at}`,
						from: "parent.tenant_id",
						to: `child${at}.tenant_id`,
						fromCardinality: "one" as const,
						toCardinality: "zero-or-many" as const,
					},
					{
						id: `id${at}`,
						from: "parent.id",
						to: `child${at}.parent_id`,
						fromCardinality: "one" as const,
						toCardinality: "zero-or-many" as const,
					},
				]).flat(),
			});
			const scene = renderDiagram(diagram);
			const parent = table(scene, "parent");
			// The parent's ends by side: tenant_id's row above id's.
			const sides = new Map<number, { y: number; row: number }[]>();
			for (const line of arrows(scene)) {
				const start = line.points[0];
				const row = Math.abs(start.y - rowY(parent, 0)) < 14 ? 0 : 1;
				sides.set(start.x, [...(sides.get(start.x) ?? []), { y: start.y, row }]);
			}
			for (const ports of sides.values()) {
				ports.sort((a, b) => a.y - b.y);
				for (const [index, port] of ports.slice(1).entries())
					if (port.row !== ports[index]!.row)
						expect(port.y - ports[index]!.y, `${children} children`).toBeGreaterThanOrEqual(9);
			}
			expect(foreignMarks(scene), `${children} children`).toEqual([]);
		}
	});

	it("places a workspace's two hubs so no lines cross, apart at their ends", () => {
		const scene = renderDiagram(erStressFixtures.saasWorkspace);
		// The organization holds five ends on its id row and users four: spread
		// over both sides, two to a side stand clear, and the row holding a third
		// grows to give it a port of its own.
		expect(crossings(arrows(scene))).toBe(0);
		expect(bunchedEnds(scene)).toBe(0);
		expect(wraps(scene)).toBe(0);
		expect(aspectOf(scene)).toBeLessThanOrEqual(2);
	});

	it("gives each of five lines on one key its own end, on that key's row", () => {
		const scene = renderDiagram(saasWorkspaceS5);
		// Two ends to a side stand clear in a row's band; a side holding a third
		// grows its row a line for each end, so no two bars or feet run together.
		expect(bunchedEnds(scene)).toBe(0);
		const organizations = table(scene, "organizations");
		const ends = arrows(scene).flatMap((line) =>
			[
				[line.sourceNodeId, line.points[0]],
				[line.targetNodeId, line.points.at(-1)!],
			].flatMap(([node, point]) => (node === "organizations" ? [point as { y: number }] : [])),
		);
		expect(ends).toHaveLength(5);
		// id's row grows a line for each end on its fuller side, 28 × 2 past a
		// plain row, and reads as one key row: a tinted band spans it, from the
		// name band's rule, its text centred, and each end meets a line of it,
		// inside the band.
		const [id, name] = fieldLines(scene, "organizations");
		expect(keyBand(scene, "organizations", 0)).toEqual({
			left: 2,
			right: 2,
			top: 40 + 2,
			bottom: 46 + 28 + 2 * 28,
			fill: "#f3ebef",
		});
		expect(id).toBe(46 + 42);
		expect(name).toBe(46 + 84 + 14);
		for (const end of ends) {
			const y = end.y - organizations.y;
			expect([id! - 28, id, id! + 28]).toContain(y);
		}
		expect(keyBand(scene, "organizations", 1)).toBeUndefined();
		// labels' row lines up with the port its line takes on the grown row, so it runs straight.
		expect(arrow(scene, "relationship-4").points).toHaveLength(2);
		expect(foreignMarks(scene)).toEqual([]);
		// Its loop from api_keys takes the upper port, inside the line from
		// projects, so the two no longer cross.
		expect(crossings(arrows(scene))).toBe(0);
		expect(wraps(scene)).toBe(0);
		expect(aspectOf(scene)).toBeLessThanOrEqual(2);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});

	it("runs a line between level ports on a grown row straight, clear of the lines climbing beside it", () => {
		const scene = renderDiagram(saasWorkspaceLabeled);
		// organizations.id holds three ends on its right: two climbing to projects
		// and labels, one level with subscriptions. Its line ran beside the climbing
		// ones closer than a reader tells apart, so the router dropped it 140 below
		// both rows and back; a line apart, it runs straight.
		expect(arrow(scene, "relationship-12").points).toHaveLength(2);
		expect(bunchedEnds(scene)).toBe(0);
		expect(crossings(arrows(scene))).toBeLessThanOrEqual(1);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});

	it("tints a grown row in a table's middle as one band, its text centred, every end inside", () => {
		const children = ["a", "b", "c", "d", "e", "f"];
		const diagram = parseErDiagram({
			id: "middle-key",
			title: "Middle key",
			type: "er",
			entities: [
				{
					id: "accounts",
					fields: [
						{ name: "region", type: "text" },
						{ name: "id", type: "int", pk: true },
						{ name: "name", type: "text" },
					],
				},
				...children.map((id) => ({
					id,
					fields: [
						{ name: "id", type: "int", pk: true },
						{ name: "account_id", type: "int", fk: true },
					],
				})),
			],
			relationships: children.map((id) => ({
				id,
				from: "accounts.id",
				to: `${id}.account_id`,
				fromCardinality: "one" as const,
				toCardinality: "zero-or-many" as const,
			})),
		});
		const scene = renderDiagram(diagram);
		const accounts = table(scene, "accounts");
		const [region, id, name] = fieldLines(scene, "accounts");
		// region keeps its plain row; id's grown row starts below it, its text centred in its band.
		expect(region).toBe(60);
		const band = keyBand(scene, "accounts", 1)!;
		expect(band.top).toBe(46 + 28);
		expect(id).toBe((band.top + band.bottom) / 2);
		expect(name).toBe(band.bottom + 14);
		expect(keyBand(scene, "accounts", 0)).toBeUndefined();
		const starts = arrows(scene).map((line) => line.points[0].y - accounts.y);
		expect(starts).toHaveLength(6);
		for (const start of starts) {
			expect(start).toBeGreaterThan(band.top);
			expect(start).toBeLessThan(band.bottom);
			expect(Math.abs(start - id!) % 28).toBe(0);
		}
		expect(bunchedEnds(scene)).toBe(0);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});

	it("keeps two ends on a one-row table's side a port step apart, clear of its corner", () => {
		const diagram = parseErDiagram({
			id: "single-row",
			title: "Single row",
			type: "er",
			entities: [
				{ id: "accounts", fields: [{ name: "id", type: "int", pk: true }] },
				...["orders", "invoices"].map((id) => ({
					id,
					fields: [
						{ name: "id", type: "int", pk: true },
						{ name: "account_id", type: "int", fk: true },
					],
				})),
			],
			relationships: ["orders", "invoices"].map((id) => ({
				id,
				from: "accounts.id",
				to: `${id}.account_id`,
				fromCardinality: "one" as const,
				toCardinality: "zero-or-many" as const,
			})),
		});
		const scene = renderDiagram(diagram);
		const accounts = table(scene, "accounts");
		const starts = arrows(scene)
			.map((line) => line.points[0].y)
			.sort((a, b) => a - b);
		expect(starts).toHaveLength(2);
		expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(20);
		expect(accounts.y + accounts.height - starts[1]!).toBeGreaterThanOrEqual(16);
		expect(bunchedEnds(scene)).toBe(0);
	});

	it("keeps a small schema within two to one, stacking tables where a row runs wide", () => {
		for (const diagram of [erFixture, orgChartEr]) {
			const scene = renderDiagram(diagram);
			expect(aspectOf(scene), diagram.id).toBeLessThanOrEqual(2);
			expect(crossings(arrows(scene)), diagram.id).toBe(0);
		}
	});

	it("arranges a twenty-table schema as a grid of columns, no line through a table", () => {
		const scene = renderDiagram(erStressFixtures.marketplace);
		const tables = nodes(scene).filter(
			(node) => node.rendererRole === "er-table" && node.kind === "entity",
		);
		expect(tables).toHaveLength(20);
		// Columns of a few tables each, not one long row or column.
		const columns = new Map<number, number>();
		for (const box of tables) {
			const middle = Math.round(box.x + box.width / 2);
			columns.set(middle, (columns.get(middle) ?? 0) + 1);
		}
		expect(columns.size).toBeGreaterThanOrEqual(4);
		expect(Math.max(...columns.values())).toBeLessThanOrEqual(6);
		const aspect = Math.max(scene.width / scene.height, scene.height / scene.width);
		expect(aspect).toBeLessThan(3.2);
		for (const [index, box] of tables.entries())
			for (const other of tables.slice(index + 1))
				expect(
					box.x < other.x + other.width &&
						other.x < box.x + box.width &&
						box.y < other.y + other.height &&
						other.y < box.y + box.height,
					`${box.id} overlaps ${other.id}`,
				).toBe(false);
		for (const line of arrows(scene)) {
			expect(orthogonal(line), line.id).toBe(true);
			for (const segment of segmentsFromPoints(line.points))
				for (const box of tables)
					if (box.nodeId !== line.sourceNodeId && box.nodeId !== line.targetNodeId)
						expect(segmentCrossesBoundsInterior(segment, box), `${line.id} through ${box.id}`).toBe(
							false,
						);
		}
	});
});
