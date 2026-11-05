import { describe, expect, it } from "vitest";
import { orgChartFixture } from "@sketchi/diagram-core";

import { candidateFromText } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";

function candidate(diagram: unknown) {
	return candidateFromText({
		model: "fixture",
		provider: "fixture",
		text: JSON.stringify({
			title: "Startup team",
			diagram,
		}),
	});
}

describe("org chart generation", () => {
	it("teaches the org chart shape when the type is requested", () => {
		const messages = buildDiagramGenerationMessages({
			id: "team",
			request: "Draw our org chart.",
			requestedType: "org-chart",
		});
		expect(messages.system).toContain("Org chart IR rules");
		expect(messages.system).toContain("dottedLines");
		expect(messages.user).toContain('"type":"org-chart"');
	});

	it("reads manager and title aliases and numbers dotted lines by their ends", () => {
		const parsed = candidate({
			id: "team",
			type: "org-chart",
			people: [
				{ id: "ceo", name: "Ada Lovelace", role: "CEO" },
				{ id: "cto", name: "Alan Turing", title: "CTO", reportsTo: "ceo" },
				{ id: "cpo", name: "Radia Perlman", title: "CPO", manager: "ceo" },
				{ id: "dev", name: "Ken Thompson", title: "Engineer", manager: "cto" },
			],
			dottedLines: [{ from: "dev", to: "cpo" }],
		});
		expect(parsed.error).toBeUndefined();
		const diagram = parsed.diagram;
		if (diagram?.type !== "org-chart") throw new Error("Expected an org chart.");
		expect(diagram.people[0]).toEqual({ id: "ceo", name: "Ada Lovelace", title: "CEO" });
		expect(diagram.people[1]?.manager).toBe("ceo");
		expect(diagram.dottedLines).toEqual([{ id: "dev-dotted-cpo", report: "dev", manager: "cpo" }]);
	});

	it("reports two top people with its repair hint", () => {
		const parsed = candidate({
			...orgChartFixture,
			people: [...orgChartFixture.people, { id: "board", name: "Board" }],
		});
		expect(parsed.diagram).toBeUndefined();
		expect(parsed.diagnostics.join(" ")).toContain("org-chart.multiple_roots");
		expect(parsed.diagnostics.join(" ")).toContain("Hint:");
	});
});
