import { describe, expect, it } from "vitest";

import { buildDiagramGenerationMessages } from "./messages.js";

const { system } = buildDiagramGenerationMessages({ id: "rules", request: "Draw it" });

describe("generation prompt rules", () => {
	it("says what a table's columns are and what a footer holds", () => {
		expect(system).toContain("table (columns: an array of header strings, rows?)");
		expect(system).toContain("footer (holds whatever the source puts at the bottom)");
	});

	it("gives every stated action a node, on return paths too", () => {
		expect(system).toContain("Give every action the scenario states its own node");
		expect(system).toContain("A return path that names an action");
	});

	it("keeps a field typed as another class in its box, with a role on its relationship", () => {
		expect(system).toContain("stays in attributes");
		expect(system).toContain("whose toRole is the field's name");
		expect(system).toContain("inside a method body draws a dependency");
	});
});
