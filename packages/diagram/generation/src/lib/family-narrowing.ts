/**
 * Decides an untyped request's diagram family by asking Jev, so its prompt carries that one
 * family's rules. Jev's answers never reach the generation model: code reads them through the
 * truth table below. Only a request no kind fits, or a Jev error or timeout, is left to the
 * generation model; each is recorded on its span.
 */
import { recordMetric, SpanContent } from "@sketchi/observability";
import { DIAGRAM_TYPES, type DiagramTypeValue } from "@sketchi/diagram-core";
import { Context, Effect, Layer, Metric, Schema } from "effect";
import { type AiError, Decision, DecisionModel } from "effect/ai";

import { workersAiJevLayer, type WorkersAiRunner } from "./jev-workers-ai.js";
import {
	anyKindFitsQuestion,
	FAMILY_NARROWING_MODEL,
	FAMILY_OPTION_NAMES,
	FAMILY_OPTIONS,
	FAMILY_THRESHOLDS,
	FamilyNarrowingInput,
	type FamilyOptionName,
	separatingQuestion,
	whichKindQuestion,
	whichOfShortlistQuestion,
} from "./family-questions.js";

const { no, sure, yes } = FAMILY_THRESHOLDS;

/**
 * What the truth table decides: one family and the row that decided it, or no family and why.
 * "sure": the re-check's Choice is sure of it. "separated": the separating question picked it
 * over the runner-up. "leading": the separating question settled nothing, so the Choice's pick.
 */
export type FamilyDecision =
	| {
			readonly _tag: "Decided";
			readonly family: DiagramTypeValue;
			readonly by: "sure" | "separated" | "leading";
	  }
	| { readonly _tag: "Undecided"; readonly reason: string };

/** What narrowing decided, with the options it re-checked, or the error that stopped it. */
export type FamilyNarrowing =
	| (FamilyDecision & { readonly shortlist: readonly FamilyOptionName[] })
	| { readonly _tag: "Failed"; readonly error: string };

/** What the request's span records of a narrowing: its outcome and the options it re-checked. */
export function familyNarrowingAttributes(narrowing: FamilyNarrowing): Record<string, string> {
	if (narrowing._tag === "Failed") return { family_narrowing: `failed: ${narrowing.error}` };
	const outcome = narrowing._tag === "Undecided" ? `undecided: ${narrowing.reason}` : narrowing.by;
	return narrowing.shortlist.length === 0
		? { family_narrowing: outcome }
		: { family_narrowing: outcome, family_shortlist: narrowing.shortlist.join(",") };
}

export class DiagramFamilyNarrowing extends Context.Service<
	DiagramFamilyNarrowing,
	{
		/**
		 * Decides `request`'s family among every kind, or among `named`, the several families the
		 * request names. Never fails: a Jev error is a `Failed` narrowing, recorded on its span.
		 */
		readonly narrow: (
			request: string,
			named?: readonly DiagramTypeValue[],
		) => Effect.Effect<FamilyNarrowing>;
	}
>()("@sketchi/diagram-generation/DiagramFamilyNarrowing") {}

// ---------------------------------------------------------------------------------------
// The truth table

const familyOf = (option: FamilyOptionName) => FAMILY_OPTIONS[option].family;

/** A Choice's probability per family: a flowchart's two options add up. */
export function familyProbabilities(
	probabilities: Readonly<Record<string, number>>,
): Map<DiagramTypeValue, number> {
	const byFamily = new Map<DiagramTypeValue, number>();
	for (const option of FAMILY_OPTION_NAMES) {
		const p = probabilities[option];
		if (p !== undefined) byFamily.set(familyOf(option), (byFamily.get(familyOf(option)) ?? 0) + p);
	}
	return byFamily;
}

/** The families of a Choice from most to least likely; a tie keeps registry order. */
function rankedFamilies(choice: Readonly<Record<string, number>>) {
	const byFamily = familyProbabilities(choice);
	return DIAGRAM_TYPES.filter((family) => byFamily.has(family))
		.map((family) => ({ family, p: byFamily.get(family) ?? 0 }))
		.sort((a, b) => b.p - a.p);
}

/** A family's most likely option in a Choice: the one a separating question asks about. */
function leadingOption(
	family: DiagramTypeValue,
	choice: Readonly<Record<string, number>>,
): FamilyOptionName | undefined {
	let best: FamilyOptionName | undefined;
	for (const option of FAMILY_OPTION_NAMES) {
		const p = choice[option];
		if (familyOf(option) !== family || p === undefined) continue;
		if (!best || p > (choice[best] ?? 0)) best = option;
	}
	return best;
}

/** How likely `a`, rather than `b`, is the right kind, by the question separating the two. */
export type Separation = (a: FamilyOptionName, b: FamilyOptionName) => number | undefined;

/**
 * One family from a re-check. A Choice at or above `sure` decides its family. Otherwise the
 * question separating the two most likely families decides: a yes for either one picks it, and
 * an answer between leaves the Choice's pick.
 */
export function decideFamily(
	choice: Readonly<Record<string, number>>,
	separation: Separation,
): FamilyDecision {
	const [leader, runnerUp] = rankedFamilies(choice);
	if (!leader) return { _tag: "Undecided", reason: "no choice" };
	if (!runnerUp || leader.p >= sure) return { _tag: "Decided", family: leader.family, by: "sure" };
	const a = leadingOption(leader.family, choice);
	const b = leadingOption(runnerUp.family, choice);
	const p = a && b ? separation(a, b) : undefined;
	if (p !== undefined && p >= yes) {
		return { _tag: "Decided", family: leader.family, by: "separated" };
	}
	if (p !== undefined && p <= no) {
		return { _tag: "Decided", family: runnerUp.family, by: "separated" };
	}
	return { _tag: "Decided", family: leader.family, by: "leading" };
}

// ---------------------------------------------------------------------------------------
// Jev requests, one span each

const narrowings = Metric.counter("sketchi_family_narrowings", {
	description: "Untyped generate requests whose family Jev decided, by outcome",
	incremental: true,
});

type Question = Decision.Classify<string> | Decision.Probability;
type Answers = Readonly<Record<string, Decision.Answer<Question> | undefined>>;

const probabilityOf = (answers: Answers, key: string) => {
	const answer = answers[key];
	return answer && "probability" in answer ? answer.probability : 0;
};
const distributionOf = (answers: Answers, key: string): Readonly<Record<string, number>> => {
	const answer = answers[key];
	return answer && "probabilities" in answer ? answer.probabilities : {};
};

/** One Jev request, with its state, every question, every answer, the model and usage. */
const askJev = Effect.fn("diagramGeneration.familyNarrowing.round")(function* (
	round: string,
	request: string,
	decisions: Readonly<Record<string, Question>>,
) {
	const state = { request };
	yield* Effect.annotateCurrentSpan({
		"gen_ai.operation.name": "decide",
		"gen_ai.provider.name": "typesafe",
		"gen_ai.request.model": FAMILY_NARROWING_MODEL,
		"sketchi.family_narrowing.round": round,
		[SpanContent.input]: { model: FAMILY_NARROWING_MODEL, questions: decisions, state },
	});
	const response = yield* DecisionModel.decide(
		Decision.make({ input: FamilyNarrowingInput, decisions }),
		{ input: state },
	);
	yield* Effect.annotateCurrentSpan({
		...(response.usage.inputTokens === undefined
			? {}
			: { "gen_ai.usage.input_tokens": response.usage.inputTokens }),
		...(response.usage.outputTokens === undefined
			? {}
			: { "gen_ai.usage.output_tokens": response.usage.outputTokens }),
		[SpanContent.output]: { answers: response.answers, usage: response.usage },
	});
	return response.answers;
});

export { askJev as askFamilyQuestions, distributionOf, probabilityOf };
export type { Answers as FamilyAnswers, Question as FamilyQuestion };

// ---------------------------------------------------------------------------------------
// The narrowing

/** The service over a DecisionModel, each Jev request cut off after `timeoutMs`. */
export const makeDiagramFamilyNarrowing = (options: { readonly timeoutMs: number }) =>
	Effect.gen(function* () {
		const model = yield* DecisionModel.DecisionModel;
		const narrow = Effect.fn("diagramGeneration.familyNarrowing")(function* (
			request: string,
			named?: readonly DiagramTypeValue[],
		) {
			const decided =
				named && named.length > 1
					? recheck("named", request, optionsOf(named), options.timeoutMs)
					: rankAndRecheck(request, options.timeoutMs);
			const result = yield* decided.pipe(
				Effect.provideService(DecisionModel.DecisionModel, model),
				Effect.catch((error): Effect.Effect<FamilyNarrowing> =>
					Effect.succeed({ _tag: "Failed", error: error.message }),
				),
			);
			yield* Effect.annotateCurrentSpan(SpanContent.output, result);
			yield* recordMetric(narrowings, 1, {
				operation: "generate",
				outcome:
					result._tag === "Decided"
						? result.by
						: result._tag === "Undecided"
							? "undecided"
							: "failed",
				provider: "typesafe",
			});
			return result;
		});
		return DiagramFamilyNarrowing.of({ narrow });
	});

export class FamilyNarrowingTimeoutError extends Schema.TaggedError<FamilyNarrowingTimeoutError>()(
	"FamilyNarrowingTimeoutError",
	{ message: Schema.String, timeoutMs: Schema.Number },
) {}

function withTimeout<A>(
	effect: Effect.Effect<A, AiError.AiError, DecisionModel.DecisionModel>,
	timeoutMs: number,
) {
	return effect.pipe(
		Effect.timeoutOrElse({
			duration: timeoutMs,
			orElse: () =>
				Effect.fail(
					FamilyNarrowingTimeoutError.make({
						message: `Jev did not answer within ${timeoutMs} ms.`,
						timeoutMs,
					}),
				),
		}),
	);
}

/** The `shortlist` options a Choice ranks highest, in the order the options are listed. */
function bestOptions(choice: Readonly<Record<string, number>>): FamilyOptionName[] {
	const best = [...FAMILY_OPTION_NAMES]
		.sort((a, b) => (choice[b] ?? 0) - (choice[a] ?? 0))
		.slice(0, FAMILY_THRESHOLDS.shortlist);
	return FAMILY_OPTION_NAMES.filter((option) => best.includes(option));
}

/** Every option of the given families, in the order the options are listed. */
function optionsOf(families: readonly DiagramTypeValue[]): FamilyOptionName[] {
	return FAMILY_OPTION_NAMES.filter((option) => families.includes(familyOf(option)));
}

const separationKey = (a: FamilyOptionName, b: FamilyOptionName) => `separate::${a}::${b}`;

/**
 * Re-check `options` with what each draws and is not for, and decide one family. The question
 * separating each two options of different families goes in the same request, though code reads
 * one only when the Choice is not sure: the questions cost less time than a second request.
 */
const recheck = Effect.fnUntraced(function* (
	round: string,
	request: string,
	options: readonly FamilyOptionName[],
	timeoutMs: number,
): Effect.fn.Return<
	FamilyNarrowing,
	AiError.AiError | FamilyNarrowingTimeoutError,
	DecisionModel.DecisionModel
> {
	const pairs = options.flatMap((a, i) =>
		options.slice(i + 1).flatMap((b) => (familyOf(a) === familyOf(b) ? [] : [[a, b] as const])),
	);
	const answers = yield* withTimeout(
		askJev(round, request, {
			which: whichOfShortlistQuestion(options),
			...Object.fromEntries(pairs.map(([a, b]) => [separationKey(a, b), separatingQuestion(a, b)])),
		}),
		timeoutMs,
	);
	const separation: Separation = (a, b) => {
		const asked = pairs.find((pair) => pair.includes(a) && pair.includes(b));
		return asked ? distributionOf(answers, separationKey(...asked))[a] : undefined;
	};
	return { ...decideFamily(distributionOf(answers, "which"), separation), shortlist: options };
});

/**
 * Rank every option, then re-check the best few with what each draws and is not for. A
 * ranking can be sure and still wrong between two near kinds, so even a sure one is re-checked.
 */
const rankAndRecheck = Effect.fnUntraced(function* (
	request: string,
	timeoutMs: number,
): Effect.fn.Return<
	FamilyNarrowing,
	AiError.AiError | FamilyNarrowingTimeoutError,
	DecisionModel.DecisionModel
> {
	const ranked = yield* withTimeout(
		askJev("rank", request, { which: whichKindQuestion(), any: anyKindFitsQuestion }),
		timeoutMs,
	);
	if (probabilityOf(ranked, "any") < no) {
		return { _tag: "Undecided", reason: "no kind fits", shortlist: [] };
	}
	return yield* recheck(
		"recheck",
		request,
		bestOptions(distributionOf(ranked, "which")),
		timeoutMs,
	);
});

/**
 * Narrowing by Jev on Workers AI, through the Worker's own AI binding. The call does not retry:
 * a rate limit or any other error decides nothing, so generation waits for no backoff.
 */
export const workersAiFamilyNarrowingLayer = (options: {
	readonly ai: WorkersAiRunner;
	readonly timeoutMs?: number;
}): Layer.Layer<DiagramFamilyNarrowing> =>
	Layer.effect(
		DiagramFamilyNarrowing,
		makeDiagramFamilyNarrowing({ timeoutMs: options.timeoutMs ?? 3_000 }),
	).pipe(Layer.provide(workersAiJevLayer({ ai: options.ai, model: FAMILY_NARROWING_MODEL })));
