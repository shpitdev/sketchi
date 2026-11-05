import { describe, expect, it } from "vitest";
import { classFixture } from "@sketchi/diagram-core";

import { candidateFromText } from "./candidates.js";

function candidate(diagram: unknown) {
	return candidateFromText({
		model: "fixture",
		provider: "fixture",
		text: JSON.stringify({
			title: "Shapes",
			diagram,
		}),
	});
}

describe("class diagram generation", () => {
	it("reads one-line members, kind aliases and unnumbered relationships", () => {
		const parsed = candidate({
			id: "shapes",
			type: "class",
			classes: [
				{ id: "Shape", kind: "abstract", methods: ["+ area(): double {abstract}"] },
				{ id: "Circle", attributes: ["- radius: double"], methods: ["+ area(): double"] },
				{ id: "Canvas", methods: ["+ add(shape: Shape): void"] },
			],
			relationships: [
				{ from: "Circle", to: "Shape", kind: "extends" },
				{ source: "Canvas", target: "Shape", kind: "aggregation", toMultiplicity: "many" },
			],
		});
		expect(parsed.error).toBeUndefined();
		const diagram = parsed.diagram;
		expect(diagram?.type).toBe("class");
		if (diagram?.type !== "class") return;
		expect(diagram.classes[1]!.attributes[0]).toEqual({
			name: "radius",
			type: "double",
			visibility: "private",
		});
		expect(
			diagram.relationships.map((relationship) => [
				relationship.id,
				relationship.kind,
				relationship.toMultiplicity,
			]),
		).toEqual([
			["Circle-inheritance-Shape", "inheritance", undefined],
			["Canvas-aggregation-Shape", "aggregation", "*"],
		]);
	});

	it("reports an interface extending a class with its repair hint", () => {
		const parsed = candidate({
			...classFixture,
			relationships: [{ id: "bad", kind: "inheritance", from: "Drawable", to: "Shape" }],
		});
		expect(parsed.diagram).toBeUndefined();
		expect(parsed.diagnostics.join(" ")).toContain("class.invalid_inheritance");
		expect(parsed.diagnostics.join(" ")).toContain("Hint:");
	});
});
