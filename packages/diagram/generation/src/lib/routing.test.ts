import { describe, expect, it } from "@effect/vitest";
import { DIAGRAM_TYPES } from "@sketchi/diagram-core";
import { Effect } from "effect";

import type { DiagramGenerationCandidate, DiagramGenerationRequest } from "./candidates.js";
import type { DiagramFamilyNarrowing, FamilyNarrowing } from "./family-narrowing.js";
import { buildDiagramGenerationMessages } from "./messages.js";
import { runDiagramGenerationWithPolicy } from "./policy.js";
import {
	namedDiagramFamilies,
	routeDiagramFamily,
	withFamilyRoute,
	withNarrowedFamilyRoute,
} from "./routing.js";

describe("routing an untyped request to the family it names", () => {
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
		expect(routeDiagramFamily(request)).toEqual({ cue: "named", family });
	});

	it("leaves a request that names several families to Jev, which decides among them", () => {
		const request = "a gantt chart of the launch, with the timeline of milestones";
		expect(namedDiagramFamilies(request)).toEqual(["timeline", "gantt"]);
		expect(routeDiagramFamily(request)).toBeUndefined();
	});

	it("does not read a family into a generic chart, diagram or code", () => {
		expect(routeDiagramFamily("make a chart of this")).toBeUndefined();
		expect(routeDiagramFamily("public class Library { private String name; }")).toBeUndefined();
		expect(routeDiagramFamily("draw a diagram of how our team works together")).toBeUndefined();
	});

	it("sends a process, pipeline or architecture request to the flowchart rules", () => {
		expect(routeDiagramFamily("diagram our deploy pipeline")).toEqual({
			cue: "shaped",
			family: "flowchart",
		});
		expect(routeDiagramFamily("draw our gcp setup: two subnets in one VPC")).toEqual({
			cue: "shaped",
			family: "flowchart",
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

	it("keeps the full prompt when the request names no family, or several", () => {
		for (const request of ["draw it", "a gantt chart and a timeline of the launch"]) {
			const prompt = routed(request);
			expect(prompt.routedType).toBeUndefined();
			expect(ruleTitles(buildDiagramGenerationMessages(prompt).system)).toHaveLength(
				DIAGRAM_TYPES.length,
			);
		}
	});

	it("names the logos only for a routed family that draws them", () => {
		const logos = [{ name: "Postgres", slug: "postgresql" }];
		expect(
			buildDiagramGenerationMessages({ id: "x", logos, request: "x", routedType: "flowchart" })
				.user,
		).toContain('In a flowchart, set "logos": true');
		expect(
			buildDiagramGenerationMessages({ id: "x", logos, request: "x", routedType: "er" }).user,
		).not.toContain("Available logos");
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

describe("deciding the family of a request its words cannot place", () => {
	const untyped = (request: string): DiagramGenerationRequest => ({
		model: "m",
		prompt: { id: "x", request },
	});
	/** A narrowing that answers `result` and records what it was asked. */
	const narrowingThat = (result: FamilyNarrowing) => {
		const asked: [string, readonly string[] | undefined][] = [];
		const service: DiagramFamilyNarrowing["Service"] = {
			narrow: (request, named) => Effect.sync(() => (asked.push([request, named]), result)),
		};
		return { asked, service };
	};

	it.effect("builds the typed prompt of the family Jev decides", () =>
		Effect.gen(function* () {
			const { asked, service } = narrowingThat({
				_tag: "Decided",
				family: "sequence",
				by: "sure",
				shortlist: ["process_flowchart", "sequence_diagram", "state_machine"],
			});
			const routed = yield* withNarrowedFamilyRoute(
				untyped("The browser asks the API, which asks the database."),
				service,
			);
			expect(asked).toEqual([["The browser asks the API, which asks the database.", undefined]]);
			expect(routed.route).toEqual({ cue: "jev", family: "sequence" });
			expect(routed.request.prompt.routedType).toBe("sequence");
		}),
	);

	it.effect("asks Jev to decide among the families a request names", () =>
		Effect.gen(function* () {
			const decided: FamilyNarrowing = {
				_tag: "Decided",
				family: "gantt",
				by: "separated",
				shortlist: ["timeline", "gantt_chart"],
			};
			const { asked, service } = narrowingThat(decided);
			const routed = yield* withNarrowedFamilyRoute(
				untyped("a gantt chart and a timeline of the launch"),
				service,
			);
			expect(asked).toEqual([
				["a gantt chart and a timeline of the launch", ["timeline", "gantt"]],
			]);
			expect(routed.route).toEqual({ cue: "jev", family: "gantt" });
			expect(routed.request.prompt.routedType).toBe("gantt");
			expect(routed.narrowing).toEqual(decided);
		}),
	);

	it.effect("asks Jev about a flowchart-shaped request, which the words alone route", () =>
		Effect.gen(function* () {
			const request = untyped("The money that flows from each source to each fund.");
			expect(withFamilyRoute(request).route).toEqual({ cue: "shaped", family: "flowchart" });
			const { asked, service } = narrowingThat({
				_tag: "Decided",
				family: "sankey",
				by: "sure",
				shortlist: ["process_flowchart", "data_chart", "sankey_diagram"],
			});
			const routed = yield* withNarrowedFamilyRoute(request, service);
			expect(asked).toHaveLength(1);
			expect(routed.route).toEqual({ cue: "jev", family: "sankey" });
		}),
	);

	it.effect("leaves the family to the generation model when no kind fits", () =>
		Effect.gen(function* () {
			for (const request of ["The parts of a car engine.", "Our deployment pipeline."]) {
				const undecided: FamilyNarrowing = {
					_tag: "Undecided",
					reason: "no kind fits",
					shortlist: [],
				};
				const routed = yield* withNarrowedFamilyRoute(
					untyped(request),
					narrowingThat(undecided).service,
				);
				expect(routed.route).toBeUndefined();
				expect(routed.request.prompt.routedType).toBeUndefined();
				expect(routed.narrowing).toEqual(undecided);
			}
		}),
	);

	it.effect("routes by the words alone when Jev fails", () =>
		Effect.gen(function* () {
			const failed: FamilyNarrowing = { _tag: "Failed", error: "Rate limit exceeded" };
			const unplaced = yield* withNarrowedFamilyRoute(
				untyped("The parts of a car engine."),
				narrowingThat(failed).service,
			);
			expect(unplaced.route).toBeUndefined();
			expect(unplaced.narrowing).toEqual(failed);
			const shaped = yield* withNarrowedFamilyRoute(
				untyped("Our deployment pipeline."),
				narrowingThat(failed).service,
			);
			expect(shaped.route).toEqual({ cue: "shaped", family: "flowchart" });
			expect(shaped.request.prompt.routedType).toBe("flowchart");
			expect(shaped.narrowing).toEqual(failed);
		}),
	);

	it.effect("asks nothing of a request that is typed, revises a diagram, or names its family", () =>
		Effect.gen(function* () {
			const { asked, service } = narrowingThat({
				_tag: "Decided",
				family: "venn",
				by: "sure",
				shortlist: ["venn_diagram"],
			});
			yield* withNarrowedFamilyRoute(
				{ model: "m", prompt: { id: "x", request: "a b c", requestedType: "mindmap" } },
				service,
			);
			yield* withNarrowedFamilyRoute(
				{ model: "m", prompt: { id: "x", request: "add c", base: { type: "flowchart" } } },
				service,
			);
			const named = yield* withNarrowedFamilyRoute(untyped("a sankey of our budget"), service);
			expect(asked).toEqual([]);
			expect(named.route).toEqual({ cue: "named", family: "sankey" });
		}),
	);
});
