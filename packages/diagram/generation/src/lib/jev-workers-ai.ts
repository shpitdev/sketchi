/**
 * Jev, TypeSafe's decision model, served from the Workers AI catalog. The
 * binding bills and logs through the Cloudflare account, so no API key is
 * involved; DecisionModel callers do not change.
 */
import { Effect, Layer, Schema } from "effect";
import { AiError, type Decision, DecisionModel } from "effect/ai";

/** The slice of a Workers AI binding Jev needs. */
export interface WorkersAiRunner {
	run(model: string, input: unknown): Promise<unknown>;
}

const Usage = Schema.Struct({
	input_tokens: Schema.optionalKey(Schema.Finite),
	output_tokens: Schema.optionalKey(Schema.Finite),
});

const Answer = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("choice"),
		choice: Schema.String,
		confidence: Schema.optionalKey(Schema.Finite),
		probabilities: Schema.optionalKey(Schema.Record(Schema.String, Schema.Finite)),
	}),
	Schema.Struct({
		type: Schema.Literal("score"),
		score: Schema.Finite,
		confidence: Schema.optionalKey(Schema.Finite),
		probabilities: Schema.optionalKey(Schema.Record(Schema.String, Schema.Finite)),
	}),
	Schema.Struct({ type: Schema.Literal("noul"), noul: Schema.Finite }),
]);

const JevResult = Schema.Struct({
	answers: Schema.Record(Schema.String, Answer),
	usage: Schema.optionalKey(Usage),
});
const decodeJevResult = Schema.decodeUnknownEffect(JevResult);

/** The binding wraps Jev's answer as `{ state, result }`; the documented shape is bare. */
function jevResult(response: unknown): unknown {
	return typeof response === "object" && response !== null && "result" in response
		? response.result
		: response;
}

const failure = (reason: AiError.AiErrorReason): AiError.AiError =>
	AiError.make({ module: "WorkersAiJev", method: "decide", reason });

/** Every decision but Locate, which needs an image. */
type TextDecision = Exclude<Decision.Any, Decision.Locate>;

/** A decision as a Jev question: Classify is a choice, Rate a score, Probability a noul. */
function jevQuestion(decision: TextDecision) {
	switch (decision._tag) {
		case "Classify":
			return { type: "choice", instructions: decision.instructions, criteria: decision.criteria };
		case "Rate":
			return {
				type: "score",
				instructions: decision.instructions,
				criteria: decision.criteria.map((level) => level.description),
			};
		case "Probability":
			return { type: "noul", instructions: decision.instructions, criteria: decision.criteria };
	}
}

/**
 * A DecisionModel answering from `typesafe/<model>` on Workers AI. Text
 * decisions only; Jev's probabilities arrive rounded to two decimals.
 */
export const makeWorkersAiJev = (options: {
	readonly ai: WorkersAiRunner;
	/** A Jev version, such as `jev-1.14.0`. */
	readonly model: string;
}) =>
	DecisionModel.make({
		probabilityPrecision: 2,
		decide: Effect.fnUntraced(function* ({
			state,
			decisions,
		}: DecisionModel.ProviderOptions<TextDecision>) {
			const questions = Object.fromEntries(
				Object.entries(decisions).map(([key, decision]) => [key, jevQuestion(decision)]),
			);
			const response = yield* Effect.tryPromise({
				try: () => options.ai.run(`typesafe/${options.model}`, { state, questions }),
				catch: (cause) =>
					failure(
						new AiError.UnknownError({ description: `Workers AI run failed: ${String(cause)}` }),
					),
			});
			const result = yield* decodeJevResult(jevResult(response)).pipe(
				Effect.mapError((error) =>
					failure(new AiError.InvalidResponseError({ description: error.message })),
				),
			);
			const answers: Record<string, DecisionModel.ProviderAnswer> = {};
			for (const [key, decision] of Object.entries(decisions)) {
				const answer = result.answers[key];
				if (answer?.type === "choice") {
					answers[key] = {
						_tag: "Classify",
						label: answer.choice,
						...(answer.probabilities ? { probabilities: answer.probabilities } : {}),
						...(answer.confidence === undefined ? {} : { confidence: answer.confidence }),
					};
				} else if (answer?.type === "score") {
					const levels = decision._tag === "Rate" ? decision.criteria : [];
					const probabilities = Object.fromEntries(
						levels.flatMap((level, index) => {
							const probability = answer.probabilities?.[String(index)];
							return probability === undefined ? [] : [[level.label, probability] as const];
						}),
					);
					answers[key] = {
						_tag: "Rate",
						rating: answer.score,
						probabilities,
						...(answer.confidence === undefined ? {} : { confidence: answer.confidence }),
					};
				} else if (answer?.type === "noul") {
					answers[key] = { _tag: "Probability", probability: answer.noul };
				}
			}
			return {
				answers,
				usage: {
					inputTokens: result.usage?.input_tokens,
					outputTokens: result.usage?.output_tokens,
				},
			};
		}),
	});

export const workersAiJevLayer = (options: {
	readonly ai: WorkersAiRunner;
	readonly model: string;
}): Layer.Layer<DecisionModel.DecisionModel> =>
	Layer.effect(DecisionModel.DecisionModel, makeWorkersAiJev(options));
