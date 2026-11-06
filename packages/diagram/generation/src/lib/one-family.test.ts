import { describe, expect, it } from "vitest";

import { buildDiagramGenerationMessages } from "./messages.js";

describe("a prompt that carries one family's rules", () => {
	it("gets the rules the full prompt states in other families' sections", () => {
		const { system } = buildDiagramGenerationMessages({
			id: "x",
			request: "revenue: EU 40.5, US 35",
			requestedType: "chart",
		});
		expect(system).not.toContain("Mindmap IR rules:");
		expect(system).toContain("Return diagram.id, a short kebab-case id.");
		expect(system).toContain("Never round a number the scenario states");
		expect(system).toContain("even where another order seems more natural");
	});

	it("names a known matrix's quadrants as the matrix does", () => {
		const { system } = buildDiagramGenerationMessages({
			id: "x",
			request: "eisenhower matrix of my week, usual names",
			requestedType: "quadrant",
		});
		expect(system).toContain("The conditions that place items are not quadrant names.");
		expect(system).toContain("use those names, even though the source does not state them");
	});

	it("leaves the full prompt as it was", () => {
		const { system } = buildDiagramGenerationMessages({ id: "x", request: "draw it" });
		expect(system).not.toContain("Return diagram.id, a short kebab-case id.");
		expect(system).not.toContain("are not quadrant names");
		expect(system).toContain("Return the diagram id.");
	});
});
