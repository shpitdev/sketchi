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
const shop = scenario("online-shop-domain-class").expectedDiagram;
const shapes = scenario("shape-hierarchy-class").expectedDiagram;
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
		expect(failed("online-shop-domain-class", reversed)).toEqual([]);
		const star = withRelationship(shop, "r1", (relationship) => ({
			...relationship,
			toMultiplicity: "*",
		}));
		expect(failed("online-shop-domain-class", star)).toEqual([]);
	});

	it("catches a reversed composition, a wrong kind, a wrong multiplicity and a lost role", () => {
		const reversedWhole = withRelationship(shop, "r3", ({ toRole: _role, ...relationship }) => ({
			...relationship,
			from: "LineItem",
			to: "Order",
			fromMultiplicity: "1",
			toMultiplicity: "1",
		}));
		expect(failed("online-shop-domain-class", reversedWhole)).toEqual([
			"relationship-kind:3",
			"multiplicity:3",
			"role:3",
		]);
		expect(
			failed(
				"online-shop-domain-class",
				withRelationship(shop, "r2", (relationship) => ({ ...relationship, kind: "composition" })),
			),
		).toEqual(["relationship-kind:2", "multiplicity:2", "role:2"]);
		expect(
			failed(
				"online-shop-domain-class",
				withRelationship(shop, "r1", (relationship) => ({
					...relationship,
					toMultiplicity: "1..*",
				})),
			),
		).toEqual(["multiplicity:1"]);
		expect(
			failed(
				"online-shop-domain-class",
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
				"shape-hierarchy-class",
				changed((node) => (node.id === "Shape" ? { ...node, kind: "class" } : node)),
			),
		).toEqual(["kind:Shape"]);
		expect(
			failed(
				"shape-hierarchy-class",
				changed((node) =>
					node.id === "Square"
						? { ...node, methods: node.methods.map(({ static: _static, ...method }) => method) }
						: node,
				),
			),
		).toEqual(["modifiers:Square.of()"]);
		expect(
			failed(
				"shape-hierarchy-class",
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
		expect(failed("shape-hierarchy-class", invented)).toEqual([
			"classes-exact",
			"relationships-exact",
		]);
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
