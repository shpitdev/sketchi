import { describe, expect, it } from "vitest";
import type { ErDiagram } from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";

import { erDrawnCheck, erScenarios } from "./er-scenarios.js";
import { evaluateScenarioDiagram } from "./evaluate.js";

const scenario = (id: string) => erScenarios.find((entry) => entry.id === id)!;
const failed = (id: string, diagram: ErDiagram) =>
	evaluateScenarioDiagram(scenario(id), diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
const shop = scenario("shop-orders-er").expectedDiagram;
type Entity = ErDiagram["entities"][number];
type Field = Entity["fields"][number];
const withField = (
	diagram: ErDiagram,
	entity: string,
	name: string,
	change: (field: Field) => Field | undefined,
): ErDiagram => ({
	...diagram,
	entities: diagram.entities.map((candidate) =>
		candidate.id === entity
			? {
					...candidate,
					fields: candidate.fields.flatMap((field) =>
						field.name === name ? (change(field) ?? []) : [field],
					),
				}
			: candidate,
	),
});

describe("prompt-grounded ER scenarios", () => {
	it("covers composite keys, a join table, a self-reference, optional ends and ten-plus tables", () => {
		const diagrams = erScenarios.map((entry) => entry.expectedDiagram);
		expect(erScenarios.length).toBeGreaterThanOrEqual(3);
		expect(diagrams.some((d) => d.entities.length >= 10)).toBe(true);
		expect(
			diagrams.some((d) =>
				d.entities.some((e) => e.fields.filter((f) => f.pk && f.fk).length >= 2),
			),
		).toBe(true);
		expect(
			diagrams.some((d) =>
				d.relationships.some((r) => r.from.split(".")[0] === r.to.split(".")[0]),
			),
		).toBe(true);
		const cardinalities = new Set(
			diagrams.flatMap((d) => d.relationships.flatMap((r) => [r.fromCardinality, r.toCardinality])),
		);
		expect([...cardinalities].sort()).toEqual([
			"one",
			"one-or-many",
			"zero-or-many",
			"zero-or-one",
		]);
	});

	it("passes its own expected diagram, including what the scene draws", () => {
		for (const entry of erScenarios)
			expect(failed(entry.id, entry.expectedDiagram), entry.id).toEqual([]);
	});

	it("accepts a relationship written the other way round, and an end that names only its entity", () => {
		const reversed: ErDiagram = {
			...shop,
			relationships: shop.relationships.map((relationship) =>
				relationship.id === "r1"
					? {
							...relationship,
							from: "orders.customer_id",
							to: "customers",
							fromCardinality: relationship.toCardinality,
							toCardinality: relationship.fromCardinality,
						}
					: relationship,
			),
		};
		expect(failed("shop-orders-er", reversed)).toEqual([]);
	});

	it("catches a wrong cardinality, a lost key marker, a wrong type and a missing field", () => {
		const wrongEnd: ErDiagram = {
			...shop,
			relationships: shop.relationships.map((relationship) =>
				relationship.id === "r1" ? { ...relationship, toCardinality: "many" } : relationship,
			),
		};
		expect(failed("shop-orders-er", wrongEnd)).toEqual(["cardinality:1"]);
		expect(
			failed(
				"shop-orders-er",
				withField(shop, "orders", "customer_id", ({ fk: _fk, ...field }) => field),
			),
		).toEqual(["keys:orders.customer_id"]);
		expect(
			failed(
				"shop-orders-er",
				withField(shop, "orders", "shipped_at", ({ nullable: _nullable, ...field }) => field),
			),
		).toEqual(["keys:orders.shipped_at"]);
		expect(
			failed(
				"shop-orders-er",
				withField(shop, "products", "price", (field) => ({ ...field, type: "float" })),
			),
		).toEqual(["type:products.price"]);
		expect(
			failed(
				"shop-orders-er",
				withField(shop, "customers", "email", () => undefined),
			),
		).toEqual(["field:customers.email", "type:customers.email", "keys:customers.email"]);
	});

	it("catches a relationship through the wrong field, and invented tables and relationships", () => {
		const wrongField: ErDiagram = {
			...shop,
			relationships: shop.relationships.map((relationship) =>
				relationship.id === "r3" ? { ...relationship, to: "order_items.order_id" } : relationship,
			),
		};
		expect(failed("shop-orders-er", wrongField)).toEqual(["relationship:3", "cardinality:3"]);
		const invented: ErDiagram = {
			...shop,
			entities: [...shop.entities, { id: "carts", fields: [] }],
			relationships: [
				...shop.relationships,
				{
					id: "extra",
					from: "customers",
					to: "carts",
					fromCardinality: "one",
					toCardinality: "many",
				},
			],
		};
		expect(failed("shop-orders-er", invented)).toEqual(["entities-exact", "relationships-exact"]);
	});

	it("reads pasted DDL: an end its constraints leave open takes any many, a stated or keyed end stays exact", () => {
		const shopDdl = scenario("shop-orders-er-v2").expectedDiagram;
		const withEnds = (diagram: ErDiagram, id: string, from: string, to: string): ErDiagram => ({
			...diagram,
			relationships: diagram.relationships.map((relationship) =>
				relationship.id === id
					? ({ ...relationship, fromCardinality: from, toCardinality: to } as typeof relationship)
					: relationship,
			),
		});
		// A customer's orders: the DDL cannot say whether a customer needs one.
		for (const many of ["zero-or-many", "many", "one-or-many"])
			expect(failed("shop-orders-er-v2", withEnds(shopDdl, "r1", "one", many))).toEqual([]);
		// The sentence says every order has an item; the not-null key, exactly one order.
		expect(failed("shop-orders-er-v2", withEnds(shopDdl, "r2", "one", "zero-or-many"))).toEqual([
			"cardinality:2",
		]);
		expect(
			failed("shop-orders-er-v2", withEnds(shopDdl, "r1", "zero-or-one", "zero-or-many")),
		).toEqual(["cardinality:1"]);
		// A nullable key is zero or one; a unique key makes the many end at most one.
		const saasDdl = scenario("saas-workspace-er-v2").expectedDiagram;
		expect(failed("saas-workspace-er-v2", withEnds(saasDdl, "r5", "one", "zero-or-many"))).toEqual([
			"cardinality:5",
		]);
		expect(failed("saas-workspace-er-v2", withEnds(saasDdl, "r11", "one", "zero-or-many"))).toEqual(
			["cardinality:11"],
		);
		// The prose prompt still states every many end.
		expect(failed("shop-orders-er", withEnds(shop, "r1", "one", "many"))).toEqual([
			"cardinality:1",
		]);
	});

	it("pastes every table and column a DDL scenario expects", () => {
		for (const entry of erScenarios.filter((candidate) => candidate.id.endsWith("-v2")))
			for (const entity of entry.expectedDiagram.entities) {
				const table = entry.prompt
					.split("\n")
					.find((line) => line.startsWith(`create table ${entity.id} (`));
				expect(table, `${entry.id} ${entity.id}`).toBeDefined();
				for (const field of entity.fields)
					expect(table, `${entry.id} ${entity.id}.${field.name}`).toMatch(
						new RegExp(`(?:\\(|, )${field.name} ${field.type!.replace(/[()]/gu, "\\$&")}`, "u"),
					);
			}
	});

	it("reads a self-reference by its fields, not by table alone", () => {
		const org = scenario("org-chart-er").expectedDiagram;
		const backwards: ErDiagram = {
			...org,
			relationships: org.relationships.map((relationship) =>
				relationship.id === "r1"
					? { ...relationship, from: "employees.id", to: "employees.manager_id" }
					: relationship,
			),
		};
		expect(failed("org-chart-er", backwards)).toEqual(["cardinality:1"]);
	});

	it("checks the drawing: a head drawn for the wrong cardinality fails", () => {
		const scene = renderDiagram(shop);
		expect(erDrawnCheck(shop, scene).passed).toBe(true);
		const tampered = {
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "arrow" && element.edgeId === "r2"
					? { ...element, endArrowhead: "crowfoot_many" as const }
					: element,
			),
		};
		expect(erDrawnCheck(shop, tampered)).toMatchObject({ passed: false });
		expect(erDrawnCheck(shop, tampered).message).toContain("r2 one-or-many end");
	});

	it("reads a table whose crowded key row grew, a text per row, as drawn", () => {
		const saas = scenario("saas-workspace-er").expectedDiagram;
		const scene = renderDiagram(saas);
		const cells = scene.elements.filter(
			(element) => element.type === "text" && element.id.startsWith("text:organizations:fields:"),
		);
		expect(cells.length).toBeGreaterThan(0);
		expect(erDrawnCheck(saas, scene)).toMatchObject({ passed: true });
		const renamed = {
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "text" && element.id === "text:organizations:fields:0"
					? { ...element, text: "uuid" }
					: element,
			),
		};
		expect(erDrawnCheck(saas, renamed).message).toContain("organizations.id row");
	});
});
