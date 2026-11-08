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
		expect(system).toContain("a group may list members at any depth and Sketchi nests them");
		expect(system).toContain(FLOWCHART_RULES.documentZonesNotNodes);
		expect(system).toContain(FLOWCHART_RULES.documentOwners("the scenario"));
		expect(system).toContain(FLOWCHART_RULES.documentFanOut);
	});

	it("says what a table's columns are and what a footer holds", () => {
		expect(system).toContain(
			"table (columns: an array of header strings, rows: placeholder count)",
		);
		expect(system).toContain(
			"Content the source places at the bottom of a screen goes in its footer, even a single line.",
		);
	});

	it("gives every stated action a node, on return paths too", () => {
		expect(system).toContain("Give every action the scenario states its own node");
		expect(system).toContain("A return path that names an action or a state, even waiting");
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
		expect(user).toContain('"from":"enrollments.student_id","to":"students.id"');
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
		expect(system).toContain(FLOWCHART_RULES.documentNodeDetails);
		expect(system).toContain(FLOWCHART_RULES.documentEdgeLabels("the scenario"));
		expect(system).toContain('layout { "direction": "LR" | "TB" } when the source states one');
	});
});

describe("rules that close the graded gap with the MCP agent", () => {
	it("keeps class relationships to what the code states and implies", () => {
		expect(system).toContain(CLASS_RULES.onlyStated("the source"));
		expect(system).toContain('with toMultiplicity "*" for a collection');
	});

	it("keeps sequence order, branch-specific steps, branch names, zones and footers as stated", () => {
		for (const rule of [
			SEQUENCE_RULES.keepOrder("the scenario"),
			FLOWCHART_RULES.noBranchBorrowing("the scenario"),
			FLOWCHART_RULES.branchNames("the scenario"),
			FLOWCHART_RULES.zonesOutside,
		]) {
			expect(system).toContain(rule);
		}
	});

	it("asks for each named technology's name to stay in the label that carries its logo", () => {
		const { user } = buildDiagramGenerationMessages({
			id: "logos",
			request: "Cache answers in Redis",
			requestedType: "flowchart",
			logos: [{ slug: "redis", name: "Redis" }],
		});
		expect(user).toContain("keep each technology's name in the label of the node about it");
	});
});

describe("generation sends only the requested family's rules", () => {
	it("keeps every family's rules when the model picks the family", () => {
		expect(system).toContain("Flowchart document rules:");
		expect(system).toContain("Quadrant chart IR rules:");
	});

	it("sends one family's rules when the caller names it", () => {
		const typed = buildDiagramGenerationMessages({
			id: "typed",
			request: "Draw it",
			requestedType: "sankey",
		}).system;
		expect(typed).toContain("Sankey IR rules:");
		expect(typed).toContain(SANKEY_RULES.dropOff("the source"));
		expect(typed).not.toContain("Flowchart document rules:");
		expect(typed).not.toContain("Wireframe IR rules:");
		expect(typed.length).toBeLessThan(system.length / 3);
	});
});

describe("revising a diagram", () => {
	const base = {
		type: "flowchart",
		id: "release-flow",
		title: "Release approval",
		nodes: [{ id: "start", label: "Change proposed", kind: "start" }],
		edges: [],
		style: { accentColor: "#000000", backgroundColor: "#ffffff" },
	};

	it("sends the current diagram and the request instead of a scenario", () => {
		const messages = buildDiagramGenerationMessages({
			id: "revise",
			request: "Add a review step",
			requestedType: "flowchart",
			base,
		});
		expect(messages.system).toContain("Revision:");
		expect(messages.system).toContain(
			"Return the complete revised diagram, not only what changed.",
		);
		expect(messages.user).toContain("Current diagram:");
		expect(messages.user).toContain('"id":"release-flow"');
		expect(messages.user).toContain("Revision request:\nAdd a review step");
		// The fixed palette is not content, and the example shape would compete with the diagram.
		expect(messages.user).not.toContain("accentColor");
		expect(messages.user).not.toContain("Expected JSON shape");
		expect(messages.user).not.toContain("Scenario:");
	});

	it("leaves a new diagram's messages without revision rules", () => {
		expect(system).not.toContain("Revision:");
	});
});

describe("rules the large scenarios showed generate missing", () => {
	it("says when an association is one way, that a titled table sits in a section, and what a not-null key decides", () => {
		expect(system).toContain(CLASS_RULES.navigableWhen("the source"));
		expect(system).toContain(WIREFRAME_RULES.titledTable("the source"));
		expect(system).toContain("A not-null key decides only toCardinality.");
	});
});
