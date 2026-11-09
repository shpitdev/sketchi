import { describe, expect, it } from "@effect/vitest";
import { makeTelemetryTestSink, makeWorkersTelemetryLayer } from "@sketchi/observability";
import { Effect, Layer } from "effect";
import { AiError, DecisionModel } from "effect/ai";

import {
	DiagramFamilyNarrowing,
	decideFamilies,
	familyNarrowingAttributes,
	type FamilyNarrowing,
	makeDiagramFamilyNarrowing,
} from "./family-narrowing.js";
import { FAMILY_OPTION_NAMES, type FamilyOptionName } from "./family-questions.js";

/** Every option at `rest`, the named ones at their own probability, renormalized. */
function choiceOf(picked: Partial<Record<FamilyOptionName, number>>) {
	const named = Object.values(picked).reduce((sum, p) => sum + (p ?? 0), 0);
	const restEach =
		Math.max(0, 1 - named) / (FAMILY_OPTION_NAMES.length - Object.keys(picked).length);
	return Object.fromEntries(
		FAMILY_OPTION_NAMES.map((option) => [option, picked[option] ?? restEach]),
	);
}

type Answer = DecisionModel.ProviderAnswer;

/**
 * A DecisionModel that answers each request from `script`, by round: the first request is the
 * ranking, the second the re-check. It keeps every request's question keys.
 */
function scriptedJev(
	script: readonly ((keys: readonly string[]) => Record<string, Answer>)[],
	failWith?: AiError.AiError,
) {
	const asked: string[][] = [];
	const layer = Layer.effect(
		DecisionModel.DecisionModel,
		DecisionModel.make({
			decide: ({ decisions }) => {
				const keys = Object.keys(decisions);
				asked.push(keys);
				if (failWith) return Effect.fail(failWith);
				const answer = script[asked.length - 1];
				if (!answer) return Effect.die(`Unexpected request ${asked.length}.`);
				return Effect.succeed({
					answers: answer(keys),
					usage: { inputTokens: 900, outputTokens: 40 },
				});
			},
		}),
	);
	return { asked, layer };
}

const classify = (probabilities: Record<string, number>): Answer => {
	const [label] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
	return { _tag: "Classify", label, probabilities };
};
const noul = (probability: number): Answer => ({ _tag: "Probability", probability });

function narrowWith(layer: Layer.Layer<DecisionModel.DecisionModel>, request = "a request") {
	const { probe, sink } = makeTelemetryTestSink();
	return Effect.gen(function* () {
		const narrowing = yield* makeDiagramFamilyNarrowing({ timeoutMs: 1_000 });
		const result: FamilyNarrowing = yield* narrowing.narrow(request);
		return { probe, result };
	}).pipe(
		Effect.provide(layer),
		Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" }, sink })),
	);
}

describe("the truth table", () => {
	const nouls = (values: Partial<Record<FamilyOptionName, number>>) =>
		new Map(FAMILY_OPTION_NAMES.map((option) => [option, values[option] ?? 0.05]));

	it("settles one family when the Choice is sure, its Noul agrees, and no other is a clear yes", () => {
		expect(
			decideFamilies(choiceOf({ sequence_diagram: 0.9 }), nouls({ sequence_diagram: 0.9 }), "t"),
		).toEqual({ _tag: "Narrowed", families: ["sequence"] });
	});

	it("adds a flowchart's two options together", () => {
		expect(
			decideFamilies(
				choiceOf({ process_flowchart: 0.4, architecture_diagram: 0.4 }),
				nouls({ architecture_diagram: 0.8 }),
				"t",
			),
		).toEqual({ _tag: "Narrowed", families: ["flowchart"] });
	});

	it("keeps every family no Noul rules out, with the Choice's pick", () => {
		expect(
			decideFamilies(
				choiceOf({ process_flowchart: 0.5, sequence_diagram: 0.4 }),
				nouls({ process_flowchart: 0.8, sequence_diagram: 0.75, state_machine: 0.4 }),
				"t",
			),
		).toEqual({ _tag: "Narrowed", families: ["flowchart", "sequence", "state-machine"] });
	});

	it("leaves the prompt whole when more than three families survive", () => {
		expect(
			decideFamilies(
				choiceOf({ process_flowchart: 0.4 }),
				nouls({
					process_flowchart: 0.6,
					sequence_diagram: 0.6,
					state_machine: 0.6,
					journey_map: 0.6,
				}),
				"t",
			),
		).toEqual({ _tag: "Unnarrowed", reason: "t: 4 families left" });
	});
});

describe("the request span's record", () => {
	it("names the outcome and the options the re-check read", () => {
		expect(
			familyNarrowingAttributes({
				_tag: "Narrowed",
				families: ["flowchart", "sequence"],
				shortlist: ["process_flowchart", "architecture_diagram", "sequence_diagram"],
			}),
		).toEqual({
			family_narrowing: "several",
			family_shortlist: "process_flowchart,architecture_diagram,sequence_diagram",
		});
		expect(
			familyNarrowingAttributes({ _tag: "Unnarrowed", reason: "no kind fits", shortlist: [] }),
		).toEqual({ family_narrowing: "unnarrowed: no kind fits" });
		expect(familyNarrowingAttributes({ _tag: "Failed", error: "Rate limit" })).toEqual({
			family_narrowing: "failed: Rate limit",
		});
	});
});

describe("narrowing with Jev", () => {
	it.effect("re-checks even a sure ranking, and settles the family the re-check is sure of", () =>
		Effect.gen(function* () {
			const { asked, layer } = scriptedJev([
				() => ({
					which: classify(choiceOf({ er_diagram: 0.9, class_diagram: 0.06, data_chart: 0.03 })),
					any: noul(0.97),
				}),
				() => ({
					which: classify({ data_chart: 0.02, er_diagram: 0.93, class_diagram: 0.05 }),
					"fits::data_chart": noul(0.05),
					"fits::er_diagram": noul(0.95),
					"fits::class_diagram": noul(0.2),
				}),
			]);
			const { probe, result } = yield* narrowWith(layer, "create table users (id int)");
			expect(result).toEqual({
				_tag: "Narrowed",
				families: ["er"],
				shortlist: ["data_chart", "er_diagram", "class_diagram"],
			});
			expect(asked).toEqual([
				["which", "any"],
				["which", "fits::data_chart", "fits::er_diagram", "fits::class_diagram"],
			]);
			const [rank, recheck] = probe.spans.filter(
				(span) => span.name === "diagramGeneration.familyNarrowing.round",
			);
			expect(rank?.attributes).toMatchObject({
				"gen_ai.provider.name": "typesafe",
				"gen_ai.request.model": "jev-1.14.0",
				"gen_ai.usage.input_tokens": 900,
				"sketchi.family_narrowing.round": "rank",
				"sketchi.input": { model: "jev-1.14.0", state: { request: "create table users (id int)" } },
			});
			expect(JSON.stringify(rank?.attributes["sketchi.input"])).toContain("Which kind of diagram");
			expect(JSON.stringify(rank?.attributes["sketchi.output"])).toContain('"er_diagram":0.9');
			expect(recheck?.attributes["sketchi.family_narrowing.round"]).toBe("recheck");
			expect(JSON.stringify(recheck?.attributes["sketchi.input"])).toContain("not_for");
		}),
	);

	it.effect("keeps the families the re-check cannot tell apart", () =>
		Effect.gen(function* () {
			const { asked, layer } = scriptedJev([
				() => ({
					which: classify(
						choiceOf({ process_flowchart: 0.45, sequence_diagram: 0.4, state_machine: 0.1 }),
					),
					any: noul(0.95),
				}),
				() => ({
					which: classify({ process_flowchart: 0.55, sequence_diagram: 0.4, state_machine: 0.05 }),
					"fits::process_flowchart": noul(0.8),
					"fits::sequence_diagram": noul(0.75),
					"fits::state_machine": noul(0.1),
				}),
			]);
			const { result } = yield* narrowWith(layer);
			expect(asked[1]).toEqual([
				"which",
				"fits::process_flowchart",
				"fits::sequence_diagram",
				"fits::state_machine",
			]);
			expect(result).toEqual({
				_tag: "Narrowed",
				families: ["flowchart", "sequence"],
				shortlist: ["process_flowchart", "sequence_diagram", "state_machine"],
			});
		}),
	);

	it.effect("narrows nothing when no shortlisted kind fits", () =>
		Effect.gen(function* () {
			const { layer } = scriptedJev([
				() => ({
					which: classify(choiceOf({ mind_map: 0.5, org_chart: 0.3, timeline: 0.1 })),
					any: noul(0.6),
				}),
				() => ({
					which: classify({ mind_map: 0.5, timeline: 0.2, org_chart: 0.3 }),
					"fits::mind_map": noul(0.2),
					"fits::timeline": noul(0.05),
					"fits::org_chart": noul(0.1),
				}),
			]);
			const { result } = yield* narrowWith(layer);
			expect(result).toEqual({
				_tag: "Unnarrowed",
				reason: "no shortlisted kind fits",
				shortlist: ["mind_map", "timeline", "org_chart"],
			});
		}),
	);

	it.effect("narrows nothing when no kind fits", () =>
		Effect.gen(function* () {
			const { asked, layer } = scriptedJev([
				() => ({ which: classify(choiceOf({ mind_map: 0.4 })), any: noul(0.1) }),
			]);
			const { result } = yield* narrowWith(layer);
			expect(result).toEqual({ _tag: "Unnarrowed", reason: "no kind fits", shortlist: [] });
			expect(asked).toHaveLength(1);
		}),
	);

	it.effect("records a Jev error on its span and narrows nothing", () =>
		Effect.gen(function* () {
			const { layer } = scriptedJev(
				[],
				AiError.make({
					module: "WorkersAiJev",
					method: "decide",
					reason: new AiError.RateLimitError({}),
				}),
			);
			const { probe, result } = yield* narrowWith(layer);
			expect(result._tag).toBe("Failed");
			const [round] = probe.spans.filter(
				(span) => span.name === "diagramGeneration.familyNarrowing.round",
			);
			expect(round?.outcome).toBe("failure");
			expect(probe.metrics.map((event) => event.attributes)).toEqual([
				{ operation: "generate", outcome: "failed", provider: "typesafe" },
			]);
		}),
	);

	it("is a service a client can take from its context", () => {
		expect(DiagramFamilyNarrowing.key).toBe("@sketchi/diagram-generation/DiagramFamilyNarrowing");
	});
});
