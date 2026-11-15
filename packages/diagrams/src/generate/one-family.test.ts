import { describe, expect, it } from "vitest";

import { buildDiagramGenerationMessages } from "./messages.js";

describe("a prompt that carries one family's rules", () => {
	it("names a known matrix's quadrants as the matrix does", () => {
		const { system } = buildDiagramGenerationMessages({
			id: "x",
			request: "eisenhower matrix of my week, usual names",
			requestedType: "quadrant",
		});
		expect(system).toContain("name each quadrant as that matrix conventionally does");
	});

	it("leaves the full prompt as it was", () => {
		const { system } = buildDiagramGenerationMessages({ id: "x", request: "draw it" });
		expect(system).not.toContain("Return diagram.id, a short kebab-case id.");
		expect(system).not.toContain("conventionally does");
		expect(system).toContain("Return the diagram id.");
	});
});
