import {
	CHART_RULES,
	CLASS_RULES,
	FLOWCHART_RULES,
	GANTT_RULES,
	ORG_CHART_RULES,
	QUADRANT_RULES,
	SANKEY_RULES,
	SEQUENCE_RULES,
	STATE_MACHINE_RULES,
	VENN_RULES,
	WIREFRAME_RULES,
} from "@sketchi/diagram-core";
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
		expect(system).toContain("the source says no row of the other side goes without one");
		expect(system).toContain("zero-or-one if the key is nullable");
		expect(system).toContain("zero-or-one if the key is unique or the sole primary key");
		expect(system).toContain('"order_id uuid PK FK" (composite)');
	});

	it("makes every named zone a group nested in the zone that holds it", () => {
		expect(system).toContain("Every zone the scenario names is its own group");
		expect(system).toContain('sets "parent" to the zone that holds it');
	});

	it("says what a table's columns are and what a footer holds", () => {
		expect(system).toContain(
			"table (columns: an array of header strings, rows: placeholder count)",
		);
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

describe("generation reads the shared family rules", () => {
	it("renders each family's rules from diagram-core in the word each family was tuned with", () => {
		for (const rule of [
			FLOWCHART_RULES.statedChecks,
			FLOWCHART_RULES.limits,
			FLOWCHART_RULES.keepNamed("the scenario"),
			SEQUENCE_RULES.replies("the scenario"),
			SEQUENCE_RULES.selfStep,
			STATE_MACHINE_RULES.kinds("the source"),
			STATE_MACHINE_RULES.endsLifecycle,
			FLOWCHART_RULES.summarizeOnlyUnnamed,
			GANTT_RULES.duration,
			CHART_RULES.unit,
			WIREFRAME_RULES.screens,
			SANKEY_RULES.dropOff("the source"),
			QUADRANT_RULES.axes("the source"),
		]) {
			expect(system).toContain(rule);
		}
	});

	it("drops rules the shared source replaced", () => {
		expect(system).not.toContain("2-4 children per major topic");
		expect(system).not.toContain("Compute a date only from a stated start");
		expect(system).not.toContain(
			"A message from a participant to itself draws as a self-message loop",
		);
	});

	it("shows an ER relationship running from its foreign key", () => {
		const { user } = buildDiagramGenerationMessages({
			id: "er",
			request: "Draw it",
			requestedType: "er",
		});
		expect(user).toContain('"from":"orders.customer_id","to":"customers.id"');
	});
});

describe("flowchart labels in generation", () => {
	it("leaves label length to the copy rule, so a label keeps the actor or component the request names", () => {
		// Short-action labels dropped "QA" and "CDN" from generated labels; agents keep the rule.
		expect(system).not.toContain(FLOWCHART_RULES.labelForm);
		expect(system).toContain("Copy everything the scenario states, in full");
	});
});

describe("quadrant placement in generation", () => {
	it("keeps generation's quadrant sentences, which put each stated name in its corner", () => {
		// "Name each quadrant by the corner its conditions describe" led to condition names
		// ("Urgent + important") in place of the names a request asks for.
		expect(system).toContain(QUADRANT_RULES.names);
		expect(system).toContain(QUADRANT_RULES.axisEnds("the source"));
		expect(system).not.toContain(QUADRANT_RULES.placementCompact);
	});
});

describe("generation reaches every field an MCP agent can set", () => {
	it("says what each optional field draws and when to set it", () => {
		for (const rule of [
			FLOWCHART_RULES.technologyLabels,
			STATE_MACHINE_RULES.layout,
			CLASS_RULES.stereotype("the source"),
			ORG_CHART_RULES.avatar,
			VENN_RULES.colorWhenStated("the source"),
			SANKEY_RULES.color("the source"),
			WIREFRAME_RULES.disabled("the source"),
		]) {
			expect(system).toContain(rule);
		}
		expect(system).toContain("may have a description");
		expect(system).toContain('layout { "direction": "LR" | "TB" } when the source states one');
	});
});
