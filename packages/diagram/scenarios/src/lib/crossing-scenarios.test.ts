import { describe, expect, it } from "vitest";

import { evaluateScenarioFixture } from "./evaluate";
import { flowchartScenarios, getFlowchartScenario } from "./scenarios";

const ids = ["photo-resize-queue-zones", "support-chat-queue", "release-hotfix-rollback"];

describe("crossing scenarios", () => {
	it.each(ids)("draws %s's fixture crossing no line its graph does not force", (id) => {
		const evaluation = evaluateScenarioFixture(getFlowchartScenario(id));
		expect(evaluation.checks.filter((check) => !check.passed)).toEqual([]);
		expect(evaluation.checks.find((check) => check.id === "avoidable-crossings")?.message).toBe(
			"Lines cross 0 time(s), as few as the graph allows.",
		);
	});

	it("checks crossings only where a scenario asks for it", () => {
		const checked = flowchartScenarios.filter((scenario) =>
			evaluateScenarioFixture(scenario).checks.some((check) => check.id === "avoidable-crossings"),
		);
		expect(checked.map((scenario) => scenario.id)).toEqual(ids);
	});
});
