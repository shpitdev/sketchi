import { describe, expect, it } from "vitest";

import { evaluateScenarioDiagram, evaluateScenarioFixture } from "./evaluate";
import { flowchartScenarios, getFlowchartScenario } from "./scenarios";

const ids = [
	"feedback-triage-curved",
	"ingest-pipeline-curved-lr",
	"checkout-services-curved-zones",
];

describe("curved scenarios", () => {
	it.each(ids)("passes %s on its fixture: every line curved, crossing nothing", (id) => {
		const evaluation = evaluateScenarioFixture(getFlowchartScenario(id));
		expect(evaluation.checks.filter((check) => !check.passed)).toEqual([]);
		expect(evaluation.checks.map((check) => check.id)).toEqual(
			expect.arrayContaining(["curved-lines", "avoidable-crossings"]),
		);
		const lines = evaluation.scene.elements.filter((element) => element.type === "arrow");
		expect(lines.every((line) => line.type === "arrow" && line.curved === true)).toBe(true);
	});

	it.each(ids)("fails %s drawn square, though the prompt asks for curved lines", (id) => {
		const scenario = getFlowchartScenario(id);
		const evaluation = evaluateScenarioDiagram(scenario, {
			...scenario.expectedDiagram,
			layout: { ...scenario.expectedDiagram.layout, edgeRouting: "orthogonal" },
		});
		expect(evaluation.checks.find((check) => check.id === "curved-lines")?.passed).toBe(false);
	});

	it("checks curved lines only where a prompt asks for them", () => {
		expect(
			flowchartScenarios
				.filter((scenario) => scenario.assertions.curved)
				.map((scenario) => scenario.id),
		).toEqual(ids);
	});
});
