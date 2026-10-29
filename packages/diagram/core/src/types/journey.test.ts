import { describe, expect, it } from "vitest";

import { parseCanonicalDiagram } from "../diagram";
import { journeyStressFixtures } from "../journey-fixtures";
import {
	getJourneyValidationIssues,
	JOURNEY_MAX_STAGE_STEPS,
	JOURNEY_MAX_STEPS,
	journeyActors,
	journeyDiagramType,
	journeyStepActors,
	journeyFixture,
	journeySentiment,
	JourneyValidationError,
	parseJourneyDiagram,
	resolveJourneyShorthand,
} from "./journey";

const journey = (stages: unknown[], extra: Record<string, unknown> = {}) => ({
	id: "checkout",
	title: "Checkout",
	type: journeyDiagramType,
	stages,
	...extra,
});

/** The issues a journey fails with, or [] when it is valid. */
function issuesOf(input: unknown) {
	try {
		parseJourneyDiagram(input);
		return [];
	} catch (error) {
		if (!(error instanceof JourneyValidationError)) throw error;
		return error.issues;
	}
}
const codes = (input: unknown) => issuesOf(input).map((issue) => issue.code);

const browse = { name: "Browse", steps: [{ label: "Search for shoes", score: 4 }] };

describe("journey contract", () => {
	it("has a typed fixture that satisfies the canonical diagram contract", () => {
		expect(journeyFixture.type).toBe(journeyDiagramType);
		expect(parseCanonicalDiagram(journeyFixture)).toEqual(journeyFixture);
		expect(journeyFixture.stages.length).toBeGreaterThan(2);
		for (const fixture of Object.values(journeyStressFixtures))
			expect(getJourneyValidationIssues(fixture)).toEqual([]);
		expect(journeyStressFixtures.longest.stages.flatMap((stage) => stage.steps).length).toBe(
			JOURNEY_MAX_STEPS,
		);
	});

	it("defaults the palette and keeps optional rows absent", () => {
		const parsed = parseJourneyDiagram(journey([browse]));
		expect(parsed.style).toMatchObject({ accentColor: expect.any(String) });
		expect(parsed.stages[0]).not.toHaveProperty("painPoints");
		expect(parsed).not.toHaveProperty("persona");
	});

	it("names each score on the 1-5 scale", () => {
		expect([1, 2, 3, 4, 5].map(journeySentiment)).toEqual([
			"Very negative",
			"Negative",
			"Neutral",
			"Positive",
			"Very positive",
		]);
	});

	it("lists actors as declared, or in the order steps first name them", () => {
		expect(
			journeyActors(
				parseJourneyDiagram(
					journey([
						{
							name: "Help",
							steps: [
								{ label: "Open a ticket", score: 2, actor: "Customer" },
								{ label: "Triage", score: 3, actor: "Agent" },
								{ label: "Reply", score: 4, actor: "Customer" },
							],
						},
					]),
				),
			),
		).toEqual(["Customer", "Agent"]);
		expect(
			journeyActors(parseJourneyDiagram(journey([browse], { actors: ["Shopper", "Courier"] }))),
		).toEqual(["Shopper", "Courier"]);
	});

	it.each([
		[
			"a score above 5",
			[{ name: "A", steps: [{ label: "x", score: 6 }] }],
			"invalid_journey_score",
		],
		[
			"a score below 1",
			[{ name: "A", steps: [{ label: "x", score: 0 }] }],
			"invalid_journey_score",
		],
		[
			"a fractional score",
			[{ name: "A", steps: [{ label: "x", score: 3.5 }] }],
			"invalid_journey_score",
		],
		["a stage without steps", [browse, { name: "Empty", steps: [] }], "empty_journey_stage"],
		["a repeated stage", [browse, { ...browse, name: " browse " }], "duplicate_journey_stage"],
		[
			"a long step label",
			[{ name: "A", steps: [{ label: "x".repeat(91), score: 3 }] }],
			"journey_text_too_long",
		],
		["a long pain point", [{ ...browse, painPoints: ["y".repeat(101)] }], "journey_text_too_long"],
		[
			"too many steps in a stage",
			[
				{
					name: "A",
					steps: Array.from({ length: JOURNEY_MAX_STAGE_STEPS + 1 }, (_, index) => ({
						label: `Step ${index}`,
						score: 3,
					})),
				},
			],
			"journey_too_large",
		],
		[
			"too many notes in a stage",
			[{ ...browse, opportunities: ["a", "b", "c", "d", "e"] }],
			"journey_too_large",
		],
	])("rejects %s", (_name, stages, code) => {
		expect(codes(journey(stages))).toContain(code);
		expect(issuesOf(journey(stages)).every((issue) => issue.hint.length > 0)).toBe(true);
	});

	it("rejects too many steps in all", () => {
		const stages = Array.from({ length: 6 }, (_, stage) => ({
			name: `Stage ${stage}`,
			steps: Array.from({ length: 7 }, (_, step) => ({ label: `Step ${stage}.${step}`, score: 3 })),
		}));
		expect(codes(journey(stages))).toContain("journey_too_large");
	});

	it("rejects a step actor the declared actors do not name, and repeated actors", () => {
		const stages = [{ name: "A", steps: [{ label: "x", score: 3, actor: "Courier" }] }];
		const issues = issuesOf(journey(stages, { actors: ["Shopper"] }));
		expect(issues.map((issue) => issue.code)).toEqual(["unknown_journey_actor"]);
		expect(issues[0]?.path).toBe("stages.[0].steps.[0].actor");
		expect(issues[0]?.hint).toContain("Shopper");
		expect(codes(journey(stages))).toEqual([]);
		expect(codes(journey(stages, { actors: ["Courier", "courier"] }))).toEqual([
			"duplicate_journey_actor",
		]);
	});

	it("reads Mermaid sections and the ways models write steps, scores and notes", () => {
		const resolved = parseJourneyDiagram(
			resolveJourneyShorthand({
				id: "buy",
				title: "Buy",
				type: "journey",
				persona: { name: "Maya", description: "first-time buyer" },
				actors: [{ name: "Maya" }, "Courier"],
				sections: [
					{
						title: "Discover",
						tasks: [
							{ task: "See an ad", sentiment: "4", channel: "Instagram", actors: ["Maya"] },
							"Read reviews: 5: Maya",
						],
						pains: "Too many choices",
						ideas: ["Comparison table"],
					},
				],
			}),
		);
		expect(resolved.persona).toBe("Maya, first-time buyer");
		expect(resolved.actors).toEqual(["Maya", "Courier"]);
		expect(resolved.stages).toEqual([
			{
				name: "Discover",
				steps: [
					{ label: "See an ad", score: 4, actor: "Maya", touchpoint: "Instagram" },
					{ label: "Read reviews", score: 5, actor: "Maya" },
				],
				painPoints: ["Too many choices"],
				opportunities: ["Comparison table"],
			},
		]);
	});

	it("keeps every actor of a shared step, from Mermaid's list or an actors array", () => {
		const resolved = parseJourneyDiagram(
			resolveJourneyShorthand({
				id: "help",
				title: "Help",
				type: "journey",
				actors: ["Customer", "Agent"],
				sections: [
					{
						title: "Review",
						tasks: [
							"Review request: 4: Customer, Agent",
							{ task: "Close ticket", score: 5, actors: ["Customer", "Agent"] },
						],
					},
				],
			}),
		);
		expect(resolved.stages[0]?.steps.map((step) => step.actor)).toEqual([
			"Customer, Agent",
			"Customer, Agent",
		]);
		expect(journeyActors({ stages: resolved.stages })).toEqual(["Customer", "Agent"]);
		// Each actor of a shared step must be declared.
		expect(
			codes(
				journey([{ name: "A", steps: [{ label: "x", score: 3, actor: "Customer, Courier" }] }], {
					actors: ["Customer", "Agent"],
				}),
			),
		).toEqual(["unknown_journey_actor"]);
	});

	it("resolves a shared step's actors against declared names that hold commas", () => {
		const diagram = parseJourneyDiagram(
			resolveJourneyShorthand({
				id: "help",
				title: "Help",
				type: "journey",
				actors: ["Smith, Jane", "Agent"],
				stages: [
					{
						name: "Review",
						steps: [{ label: "Review request", score: 4, actors: ["Smith, Jane", "Agent"] }],
					},
				],
			}),
		);
		expect(diagram.stages[0]?.steps[0]?.actor).toBe("Smith, Jane, Agent");
		expect(journeyStepActors("Smith, Jane, Agent", diagram.actors)).toEqual([
			"Smith, Jane",
			"Agent",
		]);
		expect(getJourneyValidationIssues(diagram)).toEqual([]);
	});

	it("keeps flat steps that name their stage and rejects those that name none", () => {
		const input = resolveJourneyShorthand({
			id: "buy",
			title: "Buy",
			type: "journey",
			stages: [{ name: "Discover", steps: [{ label: "Sees an ad", score: 4 }] }],
			steps: [
				{ stage: "Buy", label: "Pays", score: 3 },
				{ label: "Receives the parcel", score: 5 },
			],
		}) as { stages: { name: string; steps: { label: string }[] }[] };
		expect(
			input.stages.map((stage) => [stage.name, stage.steps.map((step) => step.label)]),
		).toEqual([
			["Discover", ["Sees an ad"]],
			["Buy", ["Pays"]],
			["(no stage)", ["Receives the parcel"]],
		]);
		const issues = issuesOf(input);
		expect(issues.map((issue) => issue.code)).toEqual(["unplaced_journey_entry"]);
		expect(issues[0]?.hint).toContain('"Discover", "Buy"');
	});

	it("rejects a flat note naming an unknown stage, or none, with the stages it may name", () => {
		const unknown = issuesOf(
			resolveJourneyShorthand({
				id: "help",
				title: "Help",
				type: "journey",
				stages: [
					{ name: "Report", steps: [{ label: "Opens a ticket", score: 2 }] },
					{ name: "Review", steps: [{ label: "Reads reply", score: 3 }] },
				],
				painPoints: [
					{ stage: "Revieew", text: "Slow reply" },
					{ stage: "Report", text: "Hidden form" },
				],
				opportunities: ["Auto-refund duplicates"],
			}),
		);
		expect(unknown.map((issue) => issue.code)).toEqual([
			"empty_journey_stage",
			"unplaced_journey_entry",
		]);
		expect(unknown[0]?.message).toContain('"Revieew"');
		expect(unknown[0]?.hint).toContain('"Report", "Review"');
		expect(unknown[1]?.message).toContain("no stage");
	});

	it("groups flat steps and notes under the stages they name, in first-use order", () => {
		const resolved = parseJourneyDiagram(
			resolveJourneyShorthand({
				id: "help",
				title: "Help",
				type: "journey",
				steps: [
					{ stage: "Report", label: "Open a ticket", score: 2 },
					{ stage: "Resolve", label: "Get a fix", score: 5 },
					{ stage: "Report", label: "Wait for a reply", score: 1 },
				],
				painPoints: [{ stage: "Report", text: "Slow first reply" }],
				opportunities: [{ stage: "Resolve", label: "Follow-up survey" }],
			}),
		);
		expect(resolved.stages.map((stage) => stage.name)).toEqual(["Report", "Resolve"]);
		expect(resolved.stages[0]?.steps.map((step) => step.label)).toEqual([
			"Open a ticket",
			"Wait for a reply",
		]);
		expect(resolved.stages[0]?.painPoints).toEqual(["Slow first reply"]);
		expect(resolved.stages[1]?.opportunities).toEqual(["Follow-up survey"]);
	});
});
