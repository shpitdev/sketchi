import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Latch, Schema } from "effect";
import { Decision, DecisionModel } from "effect/ai";

import { DiagramFamilyNarrowing, workersAiFamilyNarrowingLayer } from "./family-narrowing.js";
import { makeWorkersAiJev, type WorkersAiRunner } from "./jev-workers-ai.js";

const Request = Schema.Struct({
	questions: Schema.Record(
		Schema.String,
		Schema.Struct({
			type: Schema.String,
			criteria: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
		}),
	),
});

function runner(respond: (input: typeof Request.Type) => unknown) {
	const calls: { model: string; input: unknown }[] = [];
	const ai: WorkersAiRunner = {
		run: (model, input) => {
			calls.push({ model, input });
			// This fake implements the binding's native Promise contract.
			return Schema.decodeUnknownPromise(Request)(input).then((request) => {
				const answer = respond(request);
				if (answer instanceof Error) throw answer;
				return answer;
			});
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
			expect(response.answers["kind"]).toMatchObject({
				label: "timeline",
				confidence: 0.9,
				probabilities: { flowchart: 0.1, timeline: 0.9 },
			});
			expect(response.answers["fits"]).toMatchObject({ probability: 0.82 });
			expect(response.usage).toEqual({ inputTokens: 400, outputTokens: 20 });
		}),
	);

	it.effect("fails with an AiError when the binding throws or answers off-shape", () =>
		Effect.gen(function* () {
			const failure = Object.assign(new Error("capacity"), { requestId: "binding-request-42" });
			for (const [answer, reason] of [
				[failure, "NetworkError"],
				[undefined, "InvalidResponseError"],
				[
					{ model: "jev-1.14.0", answers: { fits: { type: "noul", noul: 2 } } },
					"InvalidOutputError",
				],
				[
					{ model: "jev-1.14.0", answers: { kind: { type: "choice", choice: "timeline" } } },
					"InvalidResponseError",
				],
				[{ state: "Failed", errors: ["capacity"] }, "InvalidResponseError"],
				[
					{ result: { model: "jev-1.14.0", answers: { fits: { type: "noul" } } } },
					"InvalidResponseError",
				],
			] as const) {
				const { ai, calls } = runner(() => answer);
				const model = yield* makeWorkersAiJev({ ai, model: "jev-1.14.0" });
				const error = yield* DecisionModel.decide(
					Decision.make({ input: Input, decisions: { fits: decisions.fits } }),
					{ input: { request: "x" } },
				).pipe(Effect.provideService(DecisionModel.DecisionModel, model), Effect.flip);
				expect(error._tag).toBe("AiError");
				expect(error.reason._tag).toBe(reason);
				expect(calls).toHaveLength(1);
				if (error.reason._tag === "NetworkError") {
					expect(error.reason).toMatchObject({
						method: "POST",
						url: "https://workers-ai.invalid/systemone",
						cause: { reason: { cause: failure } },
					});
					expect(error.reason.description).toContain("Workers AI run failed: Error: capacity");
				}
			}
		}),
	);

	it.effect("reports missing answers without retrying the binding", () =>
		Effect.gen(function* () {
			const { ai, calls } = runner(() => ({ model: "jev-1.14.0", answers: {} }));
			const model = yield* makeWorkersAiJev({ ai, model: "jev-1.14.0" });
			const error = yield* DecisionModel.decide(
				Decision.make({ input: Input, decisions: { fits: decisions.fits } }),
				{ input: { request: "x" } },
			).pipe(Effect.provideService(DecisionModel.DecisionModel, model), Effect.flip);
			expect(error.reason._tag).toBe("InvalidOutputError");
			expect(error.message).toContain("fits");
			expect(calls).toHaveLength(1);
		}),
	);

	it.effect("interrupts waiting while the binding's uncancellable work can still finish", () =>
		Effect.gen(function* () {
			const started = yield* Latch.make();
			const pending = Promise.withResolvers<unknown>();
			let bindingFinished = false;
			const ai: WorkersAiRunner = {
				run: () => {
					Latch.openUnsafe(started);
					return pending.promise.then((value) => {
						bindingFinished = true;
						return value;
					});
				},
			};
			const model = yield* makeWorkersAiJev({ ai, model: "jev-1.14.0" });
			const fiber = yield* DecisionModel.decide(
				Decision.make({ input: Input, decisions: { fits: decisions.fits } }),
				{ input: { request: "x" } },
			).pipe(Effect.provideService(DecisionModel.DecisionModel, model), Effect.forkChild);
			yield* started.await;
			yield* Fiber.interrupt(fiber);
			const exit = yield* Fiber.await(fiber);
			expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
			expect(bindingFinished).toBe(false);
			pending.resolve({ model: "jev-1.14.0", answers: { fits: { type: "noul", noul: 0.8 } } });
			yield* Effect.promise(() => pending.promise);
			expect(bindingFinished).toBe(true);
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
				model: "jev-1.14.0",
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
