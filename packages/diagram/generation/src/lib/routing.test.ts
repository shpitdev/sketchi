import { describe, expect, it } from "@effect/vitest";
import { DIAGRAM_TYPES } from "@sketchi/diagram-core";
import { Effect } from "effect";

import type { DiagramGenerationCandidate, DiagramGenerationRequest } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";
import { runDiagramGenerationWithPolicy } from "./policy.js";
import { routeDiagramFamilies, withFamilyRoute } from "./routing.js";

describe("routing an untyped request to the families it names", () => {
	it.each([
		["Make a flowchart of how a refund is approved", "flowchart"],
		["swimlane diagram of onboarding: HR, IT, Manager", "flowchart"],
		["mind map of my thesis ideas", "mindmap"],
		["Sequence diagram: client calls the API, which queries the DB", "sequence"],
		["timeline of the Apollo program", "timeline"],
		["pie chart of revenue by region: EU 40, US 35, APAC 25", "chart"],
		["Draw the state machine of a traffic light", "state-machine"],
		["gantt for the kitchen remodel", "gantt"],
		["ERD for these tables: create table users (id int primary key)", "er"],
		["UML class diagram of a parking lot", "class"],
		["organizational chart of our support team", "org-chart"],
		["venn of cats, dogs and both", "venn"],
		["customer journey for renewing a passport", "journey"],
		["sankey of where our marketing budget goes", "sankey"],
		["mockup of a settings screen with two toggles", "wireframe"],
		["2x2 of features by effort and value", "quadrant"],
	] as const)("routes %j to %s", (request, family) => {
		expect(routeDiagramFamilies(request)).toEqual({ cue: "named", families: [family] });
	});

	it("keeps every family a request names, in registry order", () => {
		expect(
			routeDiagramFamilies("a gantt chart of the launch, with the timeline of milestones"),
		).toEqual({
			cue: "named",
			families: ["timeline", "gantt"],
		});
	});

	it("does not read a family into a generic chart, diagram or code", () => {
		expect(routeDiagramFamilies("make a chart of this")).toBeUndefined();
		expect(routeDiagramFamilies("public class Library { private String name; }")).toBeUndefined();
		expect(routeDiagramFamilies("draw a diagram of how our team works together")).toBeUndefined();
	});

	it("sends a process, pipeline or architecture request to the flowchart rules", () => {
		expect(routeDiagramFamilies("diagram our deploy pipeline")).toEqual({
			cue: "shaped",
			families: ["flowchart"],
		});
		expect(routeDiagramFamilies("draw our gcp setup: two subnets in one VPC")).toEqual({
			cue: "shaped",
			families: ["flowchart"],
		});
	});

	it("leaves typed requests and revisions as they are", () => {
		const typed = {
			model: "m",
			prompt: { id: "x", request: "a timeline", requestedType: "gantt" as const },
		};
		expect(withFamilyRoute(typed).request).toBe(typed);
		const revision = {
			model: "m",
			prompt: { id: "x", request: "add a timeline", base: { type: "flowchart" } },
		};
		expect(withFamilyRoute(revision).request).toBe(revision);
	});
});

describe("the prompt of a routed request", () => {
	const routed = (request: string) =>
		withFamilyRoute({ model: "m", prompt: { id: "x", request } }).request.prompt;
	const ruleTitles = (system: string) =>
		system.split("\n").filter((line) => line.endsWith(" rules:"));

	it("is the typed prompt of the one family it names, without requiring the type", () => {
		const prompt = routed("ER diagram of: create table users (id int primary key)");
		expect(prompt.routedType).toBe("er");
		const routedMessages = buildDiagramGenerationMessages(prompt);
		const { routedType: _routed, ...withoutRoute } = prompt;
		const typed = buildDiagramGenerationMessages({ ...withoutRoute, requestedType: "er" });
		expect(routedMessages.system).toBe(typed.system);
		expect(ruleTitles(routedMessages.system)).toEqual(["ER IR rules:"]);
		expect(routedMessages.user).toContain(
			"Worked example: a different request and a correct answer.",
		);
		expect(routedMessages.user).not.toContain("Type authority");
	});

	it("keeps the full prompt when the request names several families or none", () => {
		for (const request of ["a gantt chart and a timeline of the launch", "draw it"]) {
			const prompt = routed(request);
			expect(prompt.routedType).toBeUndefined();
			expect(ruleTitles(buildDiagramGenerationMessages(prompt).system)).toHaveLength(
				DIAGRAM_TYPES.length,
			);
		}
	});

	it.effect("keeps the routed family on a repair", () =>
		Effect.gen(function* () {
			const seen: DiagramGenerationRequest[] = [];
			const invalid: DiagramGenerationCandidate = {
				diagnostics: ["json_parse_error: no JSON"],
				model: "m",
				provider: "fixture",
				text: "not json",
			};
			yield* runDiagramGenerationWithPolicy(
				(attempt) => {
					seen.push(attempt);
					return Effect.succeed(invalid);
				},
				{ model: "m", prompt: { id: "x", request: "a venn of a and b" } },
				"fixture",
				{
					concurrency: 1,
					maxRepairAttempts: 1,
					maxRetries: 0,
					requestTimeoutMs: 1_000,
					retryDelayMs: 1,
					totalTimeoutMs: 10_000,
				},
			);
			expect(seen.map((attempt) => attempt.prompt.routedType)).toEqual(["venn", "venn"]);
		}),
	);
});
