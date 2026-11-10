import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Decision, DecisionModel } from "effect/ai";

import { DiagramFamilyNarrowing, workersAiFamilyNarrowingLayer } from "./family-narrowing.js";
import { makeWorkersAiJev, type WorkersAiRunner } from "./jev-workers-ai.js";

type Question = { type: string; criteria?: Record<string, string> };

function runner(respond: (input: { questions: Record<string, Question> }) => unknown) {
	const calls: { model: string; input: unknown }[] = [];
	const ai: WorkersAiRunner = {
		run: async (model, input) => {
			calls.push({ model, input });
			const answer = respond(input as { questions: Record<string, Question> });
			if (answer instanceof Error) throw answer;
			return answer;
		},
	};
	return { ai, calls };
}

const Input = Schema.Struct({ request: Schema.String });

const decisions = {
	kind: Decision.classify({
		instructions: "Which kind?",
		criteria: { flowchart: "Steps", timeline: "Dates" },
	}),
	fits: Decision.probability({
		instructions: "Does a diagram fit?",
		criteria: { true: "Yes", false: "No" },
	}),
};

describe("Jev on Workers AI", () => {
	it.effect("sends each decision as a Jev question and reads the binding's wrapped answers", () =>
		Effect.gen(function* () {
			const { ai, calls } = runner(() => ({
				state: "Completed",
				result: {
					model: "jev-1.14.0",
					answers: {
						kind: {
							type: "choice",
							choice: "timeline",
							confidence: 0.9,
							probabilities: { flowchart: 0.1, timeline: 0.9 },
						},
						fits: { type: "noul", noul: 0.82 },
					},
					usage: { input_tokens: 400, output_tokens: 20 },
				},
			}));
			const model = yield* makeWorkersAiJev({ ai, model: "jev-1.14.0" });
			const response = yield* DecisionModel.decide(Decision.make({ input: Input, decisions }), {
				input: { request: "Release dates" },
			}).pipe(Effect.provideService(DecisionModel.DecisionModel, model));

			expect(calls).toEqual([
				{
					model: "typesafe/jev-1.14.0",
					input: {
						state: { request: "Release dates" },
						questions: {
							kind: {
								type: "choice",
								instructions: "Which kind?",
								criteria: { flowchart: "Steps", timeline: "Dates" },
							},
							fits: {
								type: "noul",
								instructions: "Does a diagram fit?",
								criteria: { true: "Yes", false: "No" },
							},
						},
					},
				},
			]);
			expect(response.answers["kind"]).toMatchObject({ label: "timeline" });
			expect(response.answers["fits"]).toMatchObject({ probability: 0.82 });
			expect(response.usage).toEqual({ inputTokens: 400, outputTokens: 20 });
		}),
	);

	it.effect("fails with an AiError when the binding throws or answers off-shape", () =>
		Effect.gen(function* () {
			for (const answer of [
				new Error("capacity"),
				{ result: { answers: { fits: { type: "noul" } } } },
			]) {
				const model = yield* makeWorkersAiJev({ ai: runner(() => answer).ai, model: "jev-1.14.0" });
				const error = yield* DecisionModel.decide(
					Decision.make({ input: Input, decisions: { fits: decisions.fits } }),
					{ input: { request: "x" } },
				).pipe(Effect.provideService(DecisionModel.DecisionModel, model), Effect.flip);
				expect(error._tag).toBe("AiError");
			}
		}),
	);

	it.effect("decides an untyped request's family through the binding", () =>
		Effect.gen(function* () {
			// Timeline takes 0.9 of each choice; the other options share the rest.
			const choice = (labels: readonly string[]) =>
				Object.fromEntries(
					labels.map((label) => [label, label === "timeline" ? 0.9 : 0.1 / (labels.length - 1)]),
				);
			const { ai, calls } = runner(({ questions }) => ({
				answers: Object.fromEntries(
					Object.entries(questions).map(([key, question]) => [
						key,
						question.type === "noul"
							? { type: "noul", noul: key === "any" ? 0.95 : 0.05 }
							: {
									type: "choice",
									choice: "timeline",
									confidence: 0.9,
									probabilities: choice(Object.keys(question.criteria ?? {})),
								},
					]),
				),
				usage: { input_tokens: 10, output_tokens: 2 },
			}));
			const result = yield* Effect.gen(function* () {
				const narrowing = yield* DiagramFamilyNarrowing;
				return yield* narrowing.narrow("When each release ships");
			}).pipe(Effect.provide(workersAiFamilyNarrowingLayer({ ai })));
			expect(result).toMatchObject({ _tag: "Decided", family: "timeline", by: "sure" });
			expect(calls.map((call) => call.model)).toEqual([
				"typesafe/jev-1.14.0",
				"typesafe/jev-1.14.0",
			]);
		}),
	);
});
