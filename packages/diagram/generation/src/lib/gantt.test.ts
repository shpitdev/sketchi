import { describe, expect, it } from "vitest";
import { GANTT_RULES, ganttFixture } from "@sketchi/diagram-core";

import { candidateFromText, enforceCandidateRequestRequirements } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";

function candidate(diagram: object, request = "release plan") {
	const { title, ...rest } = diagram as { title: string };
	return enforceCandidateRequestRequirements(
		candidateFromText({
			model: "fixture",
			provider: "fixture",
			text: JSON.stringify({
				title,
				diagram: { ...rest, type: "gantt" },
			}),
		}),
		{ model: "fixture", prompt: { id: "release", request, requestedType: "gantt" } },
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
		expect(messages.system).toContain(GANTT_RULES.dependencies("the source"));
		expect(messages.system).toContain(GANTT_RULES.listedTasks("the source"));
		expect(messages.user).toContain('"type":"gantt"');
		// The example is a conceptual plan, so it shows no dependency a request might not state.
		expect(messages.user).not.toContain("dependsOn");
	});

	it("keeps a dependency the request states in its own words", () => {
		const result = candidate(
			{
				id: "beta-plan",
				title: "Beta plan",
				tasks: [
					{ id: "build", label: "Build", start: "2026-06-01", end: "2026-06-05" },
					{
						id: "beta",
						label: "Beta",
						start: "2026-06-08",
						end: "2026-06-12",
						dependsOn: ["build"],
					},
				],
			},
			"Build June 1–5; Beta June 8–12. Beta can start only on completion of Build",
		);
		expect(result.error).toBeUndefined();
		expect(
			result.diagram?.type === "gantt" ? result.diagram.tasks.map((task) => task.dependsOn) : [],
		).toEqual([undefined, ["build"]]);
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
