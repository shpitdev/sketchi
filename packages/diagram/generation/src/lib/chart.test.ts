import { describe, expect, it } from "vitest";
import { chartFixture } from "@sketchi/diagram-core";
import { candidateFromText, enforceCandidateRequestRequirements } from "./candidates.js";

describe("chart generation", () => {
	function candidate(diagram: object = {}) {
		const { title, ...fixture } = chartFixture;
		return candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify({
				title,
				diagram: { ...fixture, ...diagram },
			}),
		});
	}
	const request = {
		model: "fixture",
		prompt: {
			id: "chart",
			request: "quarterly revenue bar chart",
			requestedType: "chart" as const,
		},
	};

	it("parses a semantic chart", () => {
		const output = candidate();
		expect(output.error).toBeUndefined();
		expect(output.diagram?.type).toBe("chart");
		expect(enforceCandidateRequestRequirements(output, request).error).toBeUndefined();
	});

	it("keeps semantic repair hints for series that do not match the categories", () => {
		const output = candidate({ series: [{ name: "2026", values: [48, 57] }] });
		expect(output.error).toBeDefined();
		expect(output.diagnostics.join(" ")).toContain("chart.chart_series_mismatch");
		expect(output.diagnostics.join(" ")).toContain("Hint:");
	});
});
