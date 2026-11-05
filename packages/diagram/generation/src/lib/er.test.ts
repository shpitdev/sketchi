import { describe, expect, it } from "vitest";
import { erFixture } from "@sketchi/diagram-core";

import { candidateFromText } from "./candidates.js";

function candidate(diagram: unknown) {
	return candidateFromText({
		model: "fixture",
		provider: "fixture",
		text: JSON.stringify({
			title: "Shop",
			diagram,
		}),
	});
}

describe("ER generation", () => {
	it("reads one-line fields, cardinality aliases and unnumbered relationships", () => {
		const parsed = candidate({
			id: "shop",
			type: "er",
			entities: [
				{ id: "customers", fields: ["id uuid PK", "email text UK"] },
				{ id: "orders", fields: ["id uuid PK", "customer_id uuid FK", "note text?"] },
			],
			relationships: [
				{
					from: "orders.customer_id",
					to: "customers.id",
					fromCardinality: "0..*",
					toCardinality: "1",
				},
				{ source: "orders", target: "customers", cardinality: "N:1" },
			],
		});
		expect(parsed.error).toBeUndefined();
		const diagram = parsed.diagram;
		expect(diagram?.type).toBe("er");
		if (diagram?.type !== "er") return;
		expect(diagram.entities[1]!.fields[2]).toEqual({ name: "note", type: "text", nullable: true });
		expect(
			diagram.relationships.map((relationship) => [
				relationship.id,
				relationship.fromCardinality,
				relationship.toCardinality,
			]),
		).toEqual([
			["orders-customer_id-customers-id", "zero-or-many", "one"],
			["orders-customers", "many", "one"],
		]);
	});

	it("accepts relationships between entities when the source states no key columns", () => {
		const parsed = candidate({
			id: "shop",
			type: "er",
			entities: [
				{ id: "customers", fields: [] },
				{ id: "orders", fields: [] },
			],
			relationships: [
				{
					id: "customers-orders",
					from: "customers",
					to: "orders",
					fromCardinality: "one",
					toCardinality: "zero-or-many",
					label: "place",
				},
			],
		});
		expect(parsed.error).toBeUndefined();
		expect(parsed.diagram).toMatchObject({
			relationships: [{ from: "customers", to: "orders" }],
		});
	});

	it("reports an unknown field with its repair hint", () => {
		const parsed = candidate({
			...erFixture,
			relationships: [{ ...erFixture.relationships[0], to: "orders.client_id" }],
		});
		expect(parsed.diagram).toBeUndefined();
		expect(parsed.diagnostics.join(" ")).toContain("er.missing_relationship_field");
		expect(parsed.diagnostics.join(" ")).toContain("Hint:");
	});
});
