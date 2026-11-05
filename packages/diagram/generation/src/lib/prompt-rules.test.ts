import { describe, expect, it } from "vitest";

import { buildDiagramGenerationMessages } from "./messages.js";

const { system } = buildDiagramGenerationMessages({ id: "rules", request: "Draw it" });

describe("generation prompt rules", () => {
	it("uses Gantt phases only when stated and keeps a persona's role", () => {
		expect(system).toContain("only when the source itself names phases; otherwise omit it");
		expect(system).toContain("persona is whose journey it is, with any role the source gives");
	});

	it("uses key columns on ER relationships only when the source states them", () => {
		expect(system).toContain('"entity.field" when the source states the key columns');
		expect(system).toContain("otherwise the entity id alone");
	});

	it("reads nullable keys and stated minimums into ER cardinality", () => {
		expect(system).toContain('"parent_id int? FK"');
		expect(system).toContain("from is the end holding the foreign key");
		expect(system).toContain("otherwise zero-or-many");
		expect(system).toContain("no row of the other side goes without one");
		expect(system).toContain("zero-or-one if the key is nullable");
		expect(system).toContain("zero-or-one if the key is unique or the sole primary key");
		expect(system).toContain('"order_id uuid PK FK" (composite)');
	});

	it("makes every named zone a group nested in the zone that holds it", () => {
		expect(system).toContain("Every zone the scenario names is its own group");
		expect(system).toContain('sets "parent" to the zone that holds it');
	});

	it("says what a table's columns are and what a footer holds", () => {
		expect(system).toContain("table (columns: an array of header strings, rows?)");
		expect(system).toContain("footer (holds whatever the source puts at the bottom)");
	});

	it("gives every stated action a node, on return paths too", () => {
		expect(system).toContain("Give every action the scenario states its own node");
		expect(system).toContain("A return path that names an action, even waiting");
	});

	it("keeps a field typed as another class in its box, with a role on its relationship", () => {
		expect(system).toContain("stays in attributes");
		expect(system).toContain("whose toRole is the field's name");
		expect(system).toContain("only pairs the source calls composed or aggregated take those kinds");
		expect(system).toContain("inside a method body draws a dependency");
	});
});
