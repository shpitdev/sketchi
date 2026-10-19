import { describe, expect, it } from "vitest";

import {
	type AxisAlignedSegment,
	erFixture,
	erStressFixtures,
	getCanvasValidationIssues,
	orgChartEr,
	parseErDiagram,
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
		expect(wrote.y).not.toBe(edited.y);
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
		expect(owns.y).not.toBe(sent.y);
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

	it("arranges a twenty-table schema as a grid of columns, no line through a table", () => {
		const scene = renderDiagram(erStressFixtures.marketplace);
		const tables = nodes(scene).filter(
			(node) => node.rendererRole === "er-table" && !node.id.endsWith(":header"),
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
