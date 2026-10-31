import { describe, expect, it } from "vitest";
import type { ClassDiagram } from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";

import { classClearanceCheck, classDrawnCheck, classScenarios } from "./class-scenarios.js";
import { evaluateScenarioDiagram } from "./evaluate.js";

const scenario = (id: string) => classScenarios.find((entry) => entry.id === id)!;
const failed = (id: string, diagram: ClassDiagram) =>
	evaluateScenarioDiagram(scenario(id), diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
const shop = scenario("online-shop-domain-class-v2").expectedDiagram;
const shapes = scenario("shape-hierarchy-class-v2").expectedDiagram;
const withRelationship = (
	diagram: ClassDiagram,
	id: string,
	change: (
		relationship: ClassDiagram["relationships"][number],
	) => ClassDiagram["relationships"][number],
): ClassDiagram => ({
	...diagram,
	relationships: diagram.relationships.map((relationship) =>
		relationship.id === id ? change(relationship) : relationship,
	),
});

describe("prompt-grounded class diagram scenarios", () => {
	it("covers every relationship kind, an interface, an abstract base, an enum and fifteen classes", () => {
		const diagrams = classScenarios.map((entry) => entry.expectedDiagram);
		expect(classScenarios.length).toBeGreaterThanOrEqual(3);
		expect(diagrams.some((d) => d.classes.length >= 15)).toBe(true);
		expect(new Set(diagrams.flatMap((d) => d.relationships.map((r) => r.kind)))).toEqual(
			new Set([
				"inheritance",
				"realization",
				"composition",
				"aggregation",
				"association",
				"dependency",
			]),
		);
		expect(new Set(diagrams.flatMap((d) => d.classes.map((c) => c.kind ?? "class")))).toEqual(
			new Set(["class", "abstract", "interface", "enum"]),
		);
	});

	it("passes its own expected diagram, including what the scene draws and its clearance", () => {
		for (const entry of classScenarios)
			expect(failed(entry.id, entry.expectedDiagram), entry.id).toEqual([]);
	});

	it("accepts an association written the other way round and 0..* written as *", () => {
		const reversed = withRelationship(shop, "r5", (relationship) => ({
			...relationship,
			from: "Payment",
			to: "Order",
			fromMultiplicity: "0..1",
			toMultiplicity: "1",
		}));
		expect(failed("online-shop-domain-class-v2", reversed)).toEqual([]);
		const star = withRelationship(shop, "r1", (relationship) => ({
			...relationship,
			toMultiplicity: "*",
		}));
		expect(failed("online-shop-domain-class-v2", star)).toEqual([]);
	});

	it("catches a reversed composition, a wrong kind, a wrong multiplicity and a lost role", () => {
		const reversedWhole = withRelationship(shop, "r3", ({ toRole: _role, ...relationship }) => ({
			...relationship,
			from: "LineItem",
			to: "Order",
			fromMultiplicity: "1",
			toMultiplicity: "1",
		}));
		expect(failed("online-shop-domain-class-v2", reversedWhole)).toEqual([
			"relationship-kind:3",
			"multiplicity:3",
			"role:3",
		]);
		expect(
			failed(
				"online-shop-domain-class-v2",
				withRelationship(shop, "r2", (relationship) => ({ ...relationship, kind: "composition" })),
			),
		).toEqual(["relationship-kind:2", "multiplicity:2", "role:2"]);
		expect(
			failed(
				"online-shop-domain-class-v2",
				withRelationship(shop, "r1", (relationship) => ({
					...relationship,
					toMultiplicity: "1..*",
				})),
			),
		).toEqual(["multiplicity:1"]);
		expect(
			failed(
				"online-shop-domain-class-v2",
				withRelationship(shop, "r1", ({ navigable: _navigable, ...relationship }) => relationship),
			),
		).toEqual(["navigable:1"]);
	});

	it("catches a wrong kind of class, a lost static or abstract marker and a wrong signature", () => {
		const changed = (
			change: (node: ClassDiagram["classes"][number]) => ClassDiagram["classes"][number],
		) => ({ ...shapes, classes: shapes.classes.map((node) => change(node)) }) as ClassDiagram;
		expect(
			failed(
				"shape-hierarchy-class-v2",
				changed((node) => (node.id === "Shape" ? { ...node, kind: "class" } : node)),
			),
		).toEqual(["kind:Shape"]);
		expect(
			failed(
				"shape-hierarchy-class-v2",
				changed((node) =>
					node.id === "Square"
						? { ...node, methods: node.methods.map(({ static: _static, ...method }) => method) }
						: node,
				),
			),
		).toEqual(["modifiers:Square.of()"]);
		expect(
			failed(
				"shape-hierarchy-class-v2",
				changed((node) =>
					node.id === "Shape"
						? {
								...node,
								methods: node.methods.map((method) =>
									method.name === "moveTo" ? { ...method, params: [method.params[0]!] } : method,
								),
							}
						: node,
				),
			),
		).toEqual(["signature:Shape.moveTo", "modifiers:Shape.moveTo()"]);
	});

	it("catches invented classes and relationships", () => {
		const invented: ClassDiagram = {
			...shapes,
			classes: [...shapes.classes, { id: "Triangle", attributes: [], methods: [] }],
			relationships: [
				...shapes.relationships,
				{ id: "extra", kind: "inheritance", from: "Triangle", to: "Shape" },
			],
		};
		expect(failed("shape-hierarchy-class-v2", invented)).toEqual([
			"classes-exact",
			"relationships-exact",
		]);
	});

	it("lets pasted source leave a relationship's kind, an end and an enum's line open", () => {
		const canvas = scenario("shape-hierarchy-class-v2").expectedDiagram;
		const shopV2 = scenario("online-shop-domain-class-v2").expectedDiagram;
		const shapesOf = (change: Parameters<typeof withRelationship>[2]) =>
			failed("shape-hierarchy-class-v2", withRelationship(canvas, "r5", change));
		// `shapes: Shape[]` says neither the kind nor the canvas end.
		expect(shapesOf((relationship) => ({ ...relationship, kind: "association" }))).toEqual([]);
		expect(
			shapesOf(({ fromMultiplicity: _from, ...relationship }) => ({
				...relationship,
				kind: "composition",
			})),
		).toEqual([]);
		expect(
			shapesOf(({ toRole: _role, ...relationship }) => ({
				...relationship,
				kind: "association",
				from: "Shape",
				to: "Canvas",
				fromMultiplicity: "*",
				toMultiplicity: "0..1",
				fromRole: "shapes",
			})),
		).toEqual([]);
		// It does say the part, its role and that there are many.
		expect(shapesOf((relationship) => ({ ...relationship, from: "Shape", to: "Canvas" }))).toEqual([
			"relationship-kind:5",
			"multiplicity:5",
			"role:5",
		]);
		expect(
			shapesOf(
				({ fromMultiplicity: _from, toMultiplicity: _to, toRole: _role, ...relationship }) => ({
					...relationship,
					kind: "dependency",
				}),
			),
		).toEqual(["relationship-kind:5", "multiplicity:5", "role:5"]);
		expect(shapesOf((relationship) => ({ ...relationship, toMultiplicity: "1" }))).toEqual([
			"multiplicity:5",
		]);
		// A single reference reads as 1 or 0..1, never many.
		const product = (toMultiplicity: string) =>
			failed(
				"online-shop-domain-class-v2",
				withRelationship(shopV2, "r4", (relationship) => ({ ...relationship, toMultiplicity })),
			);
		expect(product("0..1")).toEqual([]);
		expect(product("*")).toEqual(["multiplicity:4"]);
		// `status: OrderStatus` may draw its line or not, but not as a whole and part.
		const status = shopV2.relationships.find((relationship) => relationship.to === "OrderStatus")!;
		const withoutStatus = {
			...shopV2,
			relationships: shopV2.relationships.filter((relationship) => relationship !== status),
		};
		expect(failed("online-shop-domain-class-v2", withoutStatus)).toEqual([]);
		expect(
			failed(
				"online-shop-domain-class-v2",
				withRelationship(shopV2, status.id, (relationship) => ({
					...relationship,
					kind: "association",
					fromMultiplicity: "*",
					toMultiplicity: "1",
				})),
			),
		).toEqual([]);
		expect(
			failed(
				"online-shop-domain-class-v2",
				withRelationship(shopV2, status.id, (relationship) => ({
					...relationship,
					kind: "composition",
				})),
			),
		).toEqual(["relationship-kind:8"]);
		// Leaving it out makes no room for an invented one.
		expect(
			failed("online-shop-domain-class-v2", {
				...withoutStatus,
				relationships: [
					...withoutStatus.relationships,
					{ id: "extra", kind: "dependency", from: "Customer", to: "Product" },
				],
			}),
		).toEqual([]);
		expect(
			failed("online-shop-domain-class-v2", {
				...shopV2,
				relationships: [
					...shopV2.relationships,
					{ id: "extra", kind: "dependency", from: "Customer", to: "Product" },
				],
			}),
		).toEqual(["relationships-exact"]);
	});

	it("keeps the observer list where the pasted Java holds it", () => {
		const observer = scenario("observer-pattern-class-v2").expectedDiagram;
		expect(
			failed(
				"observer-pattern-class-v2",
				withRelationship(observer, "r1", (relationship) => ({ ...relationship, from: "Subject" })),
			),
		).toEqual(["relationship:1", "relationship-kind:1", "multiplicity:1", "role:1", "navigable:1"]);
	});

	it("checks the drawing: a wrong head or a missing multiplicity fails, and labels stand clear", () => {
		const scene = renderDiagram(shop);
		expect(classDrawnCheck(shop, scene).passed).toBe(true);
		expect(classClearanceCheck(scene).passed).toBe(true);
		const tampered = {
			...scene,
			elements: scene.elements.flatMap((element) =>
				element.type === "arrow" && element.edgeId === "r3"
					? [{ ...element, startArrowhead: "diamond_outline" as const }]
					: element.type === "text" && element.id === "relationship:r1:to:multiplicity"
						? []
						: [element],
			),
		};
		const check = classDrawnCheck(shop, tampered);
		expect(check.passed).toBe(false);
		expect(check.message).toContain("r3 composition heads");
		expect(check.message).toContain("r1 to multiplicity");
		// A multiplicity moved onto its class's box no longer stands clear.
		const order = scene.elements.find(
			(element) => element.type === "node" && element.nodeId === "Order",
		)!;
		const crowded = {
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "text" &&
				element.id === "relationship:r1:to:multiplicity" &&
				order.type === "node"
					? { ...element, x: order.x + 30, y: order.y + 30 }
					: element,
			),
		};
		expect(classClearanceCheck(crowded)).toMatchObject({ passed: false });
	});
});
