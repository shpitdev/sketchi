import { describe, expect, it } from "vitest";

import { buildDiagramGenerationMessages } from "./messages.js";

const { system } = buildDiagramGenerationMessages({ id: "rules", request: "Draw it" });

describe("generation prompt rules", () => {
	it("keeps a field typed as another class in its box, with a role on its relationship", () => {
		expect(system).toContain("stays in attributes");
		expect(system).toContain("whose toRole is the field's name");
		expect(system).toContain("inside a method body draws a dependency");
	});
});
