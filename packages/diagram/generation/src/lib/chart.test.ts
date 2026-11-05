import { describe, expect, it } from "vitest";
import { chartFixture } from "@sketchi/diagram-core";
import { candidateFromText, enforceCandidateRequestRequirements } from "./candidates.js";
import { CountRequirement } from "./intent.js";
import { buildDiagramGenerationMessages } from "./messages.js";

describe("chart generation", () => {
	function candidate(diagram: object = {}) {
		const { title, ...fixture } = chartFixture;
		return candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify({
				title,
				intent: {
					requestedKind: "chart",
					nativeKind: "chart",
					requirements: [
						{ kind: "count", target: "categories", comparator: "exact", value: 4 },
						{ kind: "label", target: "category", value: "Q3" },
						{ kind: "label", target: "series", value: "2026" },
					],
				},
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

	it("parses a semantic chart and enforces category and series requirements", () => {
		const output = candidate();
		expect(output.error).toBeUndefined();
		expect(output.diagram?.type).toBe("chart");
		expect(enforceCandidateRequestRequirements(output, request).error).toBeUndefined();
		const missing = candidate({
			categories: ["Q1", "Q2", "Q4"],
			series: [{ name: "2026", values: [1, 2, 3] }],
		});
		expect(enforceCandidateRequestRequirements(missing, request).error).toBeDefined();
	});

	function withSeriesCount(comparator: "exact" | "minimum", value: number) {
		const { title, ...fixture } = chartFixture;
		return candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify({
				title,
				intent: {
					requestedKind: "chart",
					nativeKind: "chart",
					requirements: [{ kind: "count", target: "series", comparator, value }],
				},
				diagram: fixture,
			}),
		});
	}

	it.each([
		["exact", 2],
		["minimum", 1],
	] as const)("accepts and measures a %s count of series", (comparator, value) => {
		const output = withSeriesCount(comparator, value);
		expect(output.error).toBeUndefined();
		const enforced = enforceCandidateRequestRequirements(output, request);
		expect(enforced.error).toBeUndefined();
		expect(enforced.diagram?.type).toBe("chart");
	});

	it.each([
		["exact", 3, "series must be exactly 3"],
		["minimum", 3, "series must be at least 3"],
	] as const)("fails an unmet %s count of series", (comparator, value, message) => {
		const enforced = enforceCandidateRequestRequirements(
			withSeriesCount(comparator, value),
			request,
		);
		expect(enforced.error).toBeDefined();
		expect(enforced.diagnostics.join(" ")).toContain(`requirement_count_not_met: ${message}`);
	});

	it("tells the model every count target the schema allows", () => {
		const { system } = buildDiagramGenerationMessages(request.prompt);
		const rule = system.split("\n").find((line) => line.includes("Count requirement target"));
		for (const target of CountRequirement.fields.target.literals) {
			expect(rule).toContain(`"${target}"`);
		}
	});

	it("keeps semantic repair hints for series that do not match the categories", () => {
		const output = candidate({ series: [{ name: "2026", values: [48, 57] }] });
		expect(output.error).toBeDefined();
		expect(output.diagnostics.join(" ")).toContain("chart.chart_series_mismatch");
		expect(output.diagnostics.join(" ")).toContain("Hint:");
	});
});
