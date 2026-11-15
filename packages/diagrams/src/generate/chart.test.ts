import { describe, expect, it } from "vitest";
import { chartFixture } from "../families/chart/document.js";
import { candidateFromText } from "./candidates.js";

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

	it("keeps semantic repair hints for series that do not match the categories", () => {
		const output = candidate({ series: [{ name: "2026", values: [48, 57] }] });
		expect(output.error).toBeDefined();
		expect(output.diagnostics.join(" ")).toContain("chart.chart_series_mismatch");
		expect(output.diagnostics.join(" ")).toContain("Hint:");
	});
});
