import { describe, expect, it } from "@effect/vitest";
import { makeTelemetryTestSink, makeWorkersTelemetryLayer } from "@sketchi/observability";
import { Effect, Layer } from "effect";
import { AiError, DecisionModel } from "effect/ai";

import {
	DiagramFamilyNarrowing,
	decideFamily,
	familyNarrowingAttributes,
	type FamilyNarrowing,
	makeDiagramFamilyNarrowing,
	type Separation,
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

function narrowWith(
	layer: Layer.Layer<DecisionModel.DecisionModel>,
	request = "a request",
	named?: Parameters<DiagramFamilyNarrowing["Service"]["narrow"]>[1],
) {
	const { probe, sink } = makeTelemetryTestSink();
	return Effect.gen(function* () {
		const narrowing = yield* makeDiagramFamilyNarrowing({ timeoutMs: 1_000 });
		const result: FamilyNarrowing = yield* narrowing.narrow(request, named);
		return { probe, result };
	}).pipe(
		Effect.provide(layer),
		Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" }, sink })),
	);
}

describe("the truth table", () => {
	/** A separation that answers `p` and records the two options it was asked about. */
	const separating = (p: number | undefined) => {
		const asked: [FamilyOptionName, FamilyOptionName][] = [];
		const separation: Separation = (a, b) => (asked.push([a, b]), p);
		return { asked, separation };
	};

	it("decides the family a sure Choice picks, without the separating question", () => {
		const { asked, separation } = separating(0.05);
		expect(
			decideFamily(
				{ process_flowchart: 0.15, sequence_diagram: 0.8, state_machine: 0.05 },
				separation,
			),
		).toEqual({ _tag: "Decided", family: "sequence", by: "sure" });
		expect(asked).toEqual([]);
	});

	it("adds a flowchart's two options together", () => {
		expect(
			decideFamily(
				{ process_flowchart: 0.4, architecture_diagram: 0.35, sequence_diagram: 0.25 },
				separating(0.05).separation,
			),
		).toEqual({ _tag: "Decided", family: "flowchart", by: "sure" });
	});

	it("lets the separating question decide two close families either way", () => {
		const close = { timeline: 0.55, gantt_chart: 0.45 };
		expect(decideFamily(close, separating(0.8).separation)).toEqual({
			_tag: "Decided",
			family: "timeline",
			by: "separated",
		});
		const { asked, separation } = separating(0.2);
		expect(decideFamily(close, separation)).toEqual({
			_tag: "Decided",
			family: "gantt",
			by: "separated",
		});
		expect(asked).toEqual([["timeline", "gantt_chart"]]);
	});

	it("keeps the Choice's pick when the separating question settles nothing", () => {
		const close = { timeline: 0.55, gantt_chart: 0.45 };
		for (const p of [0.5, undefined]) {
			expect(decideFamily(close, separating(p).separation)).toEqual({
				_tag: "Decided",
				family: "timeline",
				by: "leading",
			});
		}
	});

	it("separates a flowchart by its more likely option", () => {
		const { asked, separation } = separating(0.25);
		expect(
			decideFamily(
				{ process_flowchart: 0.3, architecture_diagram: 0.25, sequence_diagram: 0.45 },
				separation,
			),
		).toEqual({ _tag: "Decided", family: "sequence", by: "separated" });
		expect(asked).toEqual([["process_flowchart", "sequence_diagram"]]);
	});
});

describe("the request span's record", () => {
	it("names the row that decided, and the options the re-check read", () => {
		expect(
			familyNarrowingAttributes({
				_tag: "Decided",
				family: "sequence",
				by: "separated",
				shortlist: ["process_flowchart", "architecture_diagram", "sequence_diagram"],
			}),
		).toEqual({
			family_narrowing: "separated",
			family_shortlist: "process_flowchart,architecture_diagram,sequence_diagram",
		});
		expect(
			familyNarrowingAttributes({ _tag: "Undecided", reason: "no kind fits", shortlist: [] }),
		).toEqual({ family_narrowing: "undecided: no kind fits" });
		expect(familyNarrowingAttributes({ _tag: "Failed", error: "Rate limit" })).toEqual({
			family_narrowing: "failed: Rate limit",
		});
	});
});

describe("deciding with Jev", () => {
	it.effect("re-checks even a sure ranking, and decides the family the re-check is sure of", () =>
		Effect.gen(function* () {
			const { asked, layer } = scriptedJev([
				() => ({
					which: classify(choiceOf({ er_diagram: 0.9, class_diagram: 0.06, data_chart: 0.03 })),
					any: noul(0.97),
				}),
				() => ({
					which: classify({ data_chart: 0.02, er_diagram: 0.93, class_diagram: 0.05 }),
					"separate::data_chart::er_diagram": classify({ data_chart: 0.02, er_diagram: 0.98 }),
					"separate::data_chart::class_diagram": classify({ data_chart: 0.1, class_diagram: 0.9 }),
					"separate::er_diagram::class_diagram": classify({ er_diagram: 0.9, class_diagram: 0.1 }),
				}),
			]);
			const { probe, result } = yield* narrowWith(layer, "create table users (id int)");
			expect(result).toEqual({
				_tag: "Decided",
				family: "er",
				by: "sure",
				shortlist: ["data_chart", "er_diagram", "class_diagram"],
			});
			expect(asked).toEqual([
				["which", "any"],
				[
					"which",
					"separate::data_chart::er_diagram",
					"separate::data_chart::class_diagram",
					"separate::er_diagram::class_diagram",
				],
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

	it.effect("separates two close families with the question asked in the re-check", () =>
		Effect.gen(function* () {
			const { asked, layer } = scriptedJev([
				() => ({
					which: classify(
						choiceOf({ process_flowchart: 0.45, sequence_diagram: 0.4, state_machine: 0.1 }),
					),
					any: noul(0.95),
				}),
				() => ({
					which: classify({ process_flowchart: 0.5, sequence_diagram: 0.45, state_machine: 0.05 }),
					"separate::process_flowchart::sequence_diagram": classify({
						process_flowchart: 0.2,
						sequence_diagram: 0.8,
					}),
					"separate::process_flowchart::state_machine": classify({
						process_flowchart: 0.9,
						state_machine: 0.1,
					}),
					"separate::sequence_diagram::state_machine": classify({
						sequence_diagram: 0.9,
						state_machine: 0.1,
					}),
				}),
			]);
			const { probe, result } = yield* narrowWith(layer);
			expect(asked).toHaveLength(2);
			expect(result).toEqual({
				_tag: "Decided",
				family: "sequence",
				by: "separated",
				shortlist: ["process_flowchart", "sequence_diagram", "state_machine"],
			});
			expect(probe.metrics.map((event) => event.attributes)).toEqual([
				{ operation: "generate", outcome: "separated", provider: "typesafe" },
			]);
		}),
	);

	it.effect("decides among the families a request names, in one request", () =>
		Effect.gen(function* () {
			const { asked, layer } = scriptedJev([
				() => ({
					which: classify({ timeline: 0.4, gantt_chart: 0.6 }),
					"separate::timeline::gantt_chart": classify({ timeline: 0.15, gantt_chart: 0.85 }),
				}),
			]);
			const { probe, result } = yield* narrowWith(layer, "a gantt chart or a timeline", [
				"timeline",
				"gantt",
			]);
			expect(asked).toEqual([["which", "separate::timeline::gantt_chart"]]);
			expect(result).toEqual({
				_tag: "Decided",
				family: "gantt",
				by: "separated",
				shortlist: ["timeline", "gantt_chart"],
			});
			const [round] = probe.spans.filter(
				(span) => span.name === "diagramGeneration.familyNarrowing.round",
			);
			expect(round?.attributes["sketchi.family_narrowing.round"]).toBe("named");
		}),
	);

	it.effect("decides nothing when no kind fits", () =>
		Effect.gen(function* () {
			const { asked, layer } = scriptedJev([
				() => ({ which: classify(choiceOf({ mind_map: 0.4 })), any: noul(0.1) }),
			]);
			const { result } = yield* narrowWith(layer);
			expect(result).toEqual({ _tag: "Undecided", reason: "no kind fits", shortlist: [] });
			expect(asked).toHaveLength(1);
		}),
	);

	it.effect("records a Jev error on its span and decides nothing", () =>
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
