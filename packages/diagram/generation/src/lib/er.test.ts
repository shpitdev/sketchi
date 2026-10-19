import { describe, expect, it } from "vitest";
import { erFixture } from "@sketchi/diagram-core";

import { candidateFromText, enforceCandidateRequestRequirements } from "./candidates.js";

const request = {
	model: "fixture",
	prompt: { id: "shop", request: "shop schema", requestedType: "er" as const },
};

function candidate(diagram: unknown, requirements: readonly unknown[] = []) {
	return candidateFromText({
		model: "fixture",
		provider: "fixture",
		text: JSON.stringify({
			title: "Shop",
			intent: { requestedKind: "er", nativeKind: "er", requirements },
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

	it("reports an unknown field with its repair hint", () => {
		const parsed = candidate({
			...erFixture,
			relationships: [{ ...erFixture.relationships[0], to: "orders.client_id" }],
		});
		expect(parsed.diagram).toBeUndefined();
		expect(parsed.diagnostics.join(" ")).toContain("er.missing_relationship_field");
		expect(parsed.diagnostics.join(" ")).toContain("Hint:");
	});

	it("checks entity and relationship counts and entity and field names", () => {
		const met = enforceCandidateRequestRequirements(
			candidate(erFixture, [
				{ kind: "count", target: "entities", comparator: "exact", value: 4 },
				{ kind: "count", target: "relationships", comparator: "minimum", value: 3 },
				{ kind: "label", target: "entity", value: "order_items" },
				{ kind: "label", target: "field", value: "customer_id" },
			]),
			request,
		);
		expect(met.error).toBeUndefined();
		const unmet = enforceCandidateRequestRequirements(
			candidate(erFixture, [
				{ kind: "count", target: "entities", comparator: "exact", value: 5 },
				{ kind: "label", target: "field", value: "coupon_id" },
			]),
			request,
		);
		expect(unmet.diagnostics.join(" ")).toContain("requirement_count_not_met");
		expect(unmet.diagnostics.join(" ")).toContain('required field label "coupon_id"');
	});
});
