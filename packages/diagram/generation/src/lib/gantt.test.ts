import { describe, expect, it } from "vitest";
import { ganttFixture } from "@sketchi/diagram-core";

import { candidateFromText, enforceCandidateRequestRequirements } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";

const request = {
	model: "fixture",
	prompt: { id: "release", request: "release plan", requestedType: "gantt" as const },
};
function candidate(diagram: object, requirements: readonly object[] = []) {
	const { title, ...rest } = diagram as { title: string };
	return enforceCandidateRequestRequirements(
		candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify({
				title,
				intent: { requestedKind: "gantt", nativeKind: "gantt", requirements },
				diagram: { ...rest, type: "gantt" },
			}),
		}),
		request,
	);
}

describe("Gantt generation", () => {
	it("asks for tasks with dates or durations, never coordinates", () => {
		const messages = buildDiagramGenerationMessages({
			id: "release",
			request: "Plan the release",
			requestedType: "gantt",
		});
		expect(messages.system).toContain("Gantt IR rules");
		expect(messages.system).toContain("dependsOn");
		expect(messages.user).toContain('"type":"gantt"');
	});

	it("checks task counts and task and phase labels against the plan", () => {
		expect(
			candidate(ganttFixture, [
				{ kind: "count", target: "tasks", comparator: "exact", value: 5 },
				{ kind: "label", target: "task", value: "Web app" },
				{ kind: "label", target: "phase", value: "Launch" },
			]).error,
		).toBeUndefined();
		expect(
			candidate(ganttFixture, [
				{ kind: "count", target: "tasks", comparator: "exact", value: 6 },
			]).diagnostics.join(" "),
		).toContain("requirement_count_not_met");
	});

	it("returns repair hints for an invalid plan", () => {
		const result = candidate({
			...ganttFixture,
			tasks: ganttFixture.tasks.map((task) =>
				task.id === "design" ? { ...task, dependsOn: ["release"] } : task,
			),
		});
		expect(result.error).toBeDefined();
		expect(result.diagnostics.join(" ")).toContain("gantt.gantt_dependency_cycle");
		expect(result.diagnostics.join(" ")).toContain("Hint:");
	});
});
