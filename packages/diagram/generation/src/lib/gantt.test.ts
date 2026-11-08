import { describe, expect, it } from "vitest";
import { GANTT_RULES, ganttFixture } from "@sketchi/diagram-core";

import { candidateFromText, enforceCandidateRequestRequirements } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";

function candidate(
	diagram: object,
	prompt: { readonly request: string; readonly base?: Record<string, unknown> } = {
		request: "release plan",
	},
) {
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
		{ model: "fixture", prompt: { id: "release", requestedType: "gantt", ...prompt } },
	);
}

/** A launch plan of dated phases, as a model that chained them in date order answered it. */
const chainedLaunchPlan = {
	id: "launch-plan",
	title: "Launch plan",
	tasks: [
		{ id: "discovery", label: "Discovery", start: "2026-01-05", end: "2026-02-13" },
		{
			id: "build",
			label: "Build",
			start: "2026-02-16",
			end: "2026-05-29",
			dependsOn: ["discovery"],
		},
		{ id: "beta", label: "Beta", start: "2026-06-01", end: "2026-07-31", dependsOn: ["build"] },
		{ id: "launch", label: "Launch", start: "2026-08-04", milestone: true, dependsOn: ["beta"] },
	],
};
const dependencies = (result: ReturnType<typeof candidate>) =>
	result.diagram?.type === "gantt"
		? result.diagram.tasks.flatMap((task) => (task.dependsOn ?? []).map((id) => `${id}→${task.id}`))
		: [];

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

	it("draws no dependency for a plan that only lists dated phases", () => {
		const result = candidate(chainedLaunchPlan, {
			request:
				"launch plan chart (2026)\nphases: discovery jan 5 - feb 13, build feb 16 - may 29, beta jun 1 - jul 31\nmilestones: design freeze feb 13, launch aug 4",
		});
		expect(result.error).toBeUndefined();
		expect(dependencies(result)).toEqual([]);
		expect(result.diagnostics).toContain(
			"gantt_dependencies_unstated: removed 3 dependencies the request does not state.",
		);
	});

	it.each([
		"phase | task | start | end | after\nBuild | Beta | Jun 1 | Jul 31 | Build",
		"Beta starts once build is done, and launch follows beta.",
		"Discovery -> Build -> Beta -> Launch",
	])("keeps the dependencies a request states: %s", (request) => {
		const result = candidate(chainedLaunchPlan, { request });
		expect(dependencies(result)).toEqual(["discovery→build", "build→beta", "beta→launch"]);
		expect(result.diagnostics.join(" ")).not.toContain("gantt_dependencies_unstated");
	});

	it("keeps the dependencies of a chart a revision changes", () => {
		const result = candidate(chainedLaunchPlan, {
			request: "move launch to Aug 10",
			base: { ...chainedLaunchPlan, type: "gantt" },
		});
		expect(dependencies(result)).toEqual(["discovery→build", "build→beta", "beta→launch"]);
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
