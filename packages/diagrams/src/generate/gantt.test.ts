import { describe, expect, it } from "vitest";
import { ganttFixture } from "../families/gantt/document.js";

import { candidateFromText, enforceCandidateRequestRequirements } from "./candidates.js";

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
