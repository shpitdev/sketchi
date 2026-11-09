/**
 * Narrows an untyped request to the diagram families it could mean, by asking Jev, so its
 * prompt carries only their rules. Jev's answers never reach the generation model: code reads
 * them through the truth table below and decides which families' rules the prompt carries.
 * A Jev error or timeout is recorded on its span and narrows nothing.
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
	kindFitsQuestion,
	whichKindQuestion,
	whichOfShortlistQuestion,
} from "./family-questions.js";

const { maxFamilies, no, sure, yes } = FAMILY_THRESHOLDS;

/** What the truth table decides: a few families' rules, or every family's and why. */
export type FamilyDecision =
	| { readonly _tag: "Narrowed"; readonly families: readonly DiagramTypeValue[] }
	| { readonly _tag: "Unnarrowed"; readonly reason: string };

/** What narrowing decided, with the options it re-checked, or the error that stopped it. */
export type FamilyNarrowing =
	| (FamilyDecision & { readonly shortlist: readonly FamilyOptionName[] })
	| { readonly _tag: "Failed"; readonly error: string };

/** What the request's span records of a narrowing: its outcome and the options it re-checked. */
export function familyNarrowingAttributes(narrowing: FamilyNarrowing): Record<string, string> {
	if (narrowing._tag === "Failed") return { family_narrowing: `failed: ${narrowing.error}` };
	const outcome =
		narrowing._tag === "Unnarrowed"
			? `unnarrowed: ${narrowing.reason}`
			: narrowing.families.length === 1
				? "one"
				: "several";
	return narrowing.shortlist.length === 0
		? { family_narrowing: outcome }
		: { family_narrowing: outcome, family_shortlist: narrowing.shortlist.join(",") };
}

export class DiagramFamilyNarrowing extends Context.Service<
	DiagramFamilyNarrowing,
	{
		/** Never fails: a Jev error is a `Failed` narrowing, recorded on its span. */
		readonly narrow: (request: string) => Effect.Effect<FamilyNarrowing>;
	}
>()("@sketchi/diagram-generation/DiagramFamilyNarrowing") {}

// ---------------------------------------------------------------------------------------
// The truth table

const familyOf = (option: FamilyOptionName) => FAMILY_OPTIONS[option].family;

export function inRegistryOrder(families: Iterable<DiagramTypeValue>): DiagramTypeValue[] {
	const set = new Set(families);
	return DIAGRAM_TYPES.filter((family) => set.has(family));
}

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

/** A Noul per family: the most likely of its options. */
export function familyNouls(
	nouls: ReadonlyMap<FamilyOptionName, number>,
): Map<DiagramTypeValue, number> {
	const byFamily = new Map<DiagramTypeValue, number>();
	for (const [option, p] of nouls) {
		byFamily.set(familyOf(option), Math.max(byFamily.get(familyOf(option)) ?? 0, p));
	}
	return byFamily;
}

export function mostLikely(
	byFamily: ReadonlyMap<DiagramTypeValue, number>,
): { readonly family: DiagramTypeValue; readonly p: number } | undefined {
	let best: { family: DiagramTypeValue; p: number } | undefined;
	for (const [family, p] of byFamily) if (!best || p > best.p) best = { family, p };
	return best;
}

/** One to `maxFamilies` candidates narrow the prompt; none, or more, leave it whole. */
export function narrowTo(families: Iterable<DiagramTypeValue>, reason: string): FamilyDecision {
	const ordered = inRegistryOrder(families);
	return ordered.length >= 1 && ordered.length <= maxFamilies
		? { _tag: "Narrowed", families: ordered }
		: {
				_tag: "Unnarrowed",
				reason:
					ordered.length === 0
						? `${reason}: no family left`
						: `${reason}: ${ordered.length} families left`,
			};
}

/**
 * A Choice over some options and a Noul per option. A sure Choice whose Noul is a yes, with no
 * other family a clear yes, settles one family. Otherwise every family no Noul rules out, with
 * the Choice's pick unless it too is unlikely, is a candidate.
 */
export function decideFamilies(
	choice: Readonly<Record<string, number>>,
	nouls: ReadonlyMap<FamilyOptionName, number>,
	reason: string,
): FamilyDecision {
	const best = mostLikely(familyProbabilities(choice));
	if (!best) return { _tag: "Unnarrowed", reason: `${reason}: no choice` };
	const byFamily = familyNouls(nouls);
	const clearYes = [...byFamily].filter(([, p]) => p >= yes).map(([family]) => family);
	if (
		best.p >= sure &&
		(byFamily.get(best.family) ?? 0) >= yes &&
		clearYes.every((family) => family === best.family)
	) {
		return { _tag: "Narrowed", families: [best.family] };
	}
	const candidates = [...byFamily].filter(([, p]) => p >= no).map(([family]) => family);
	if (best.p >= no) candidates.push(best.family);
	return narrowTo(candidates, reason);
}

// ---------------------------------------------------------------------------------------
// Jev requests, one span each

const narrowings = Metric.counter("sketchi_family_narrowings", {
	description: "Untyped generate requests narrowed by Jev, by outcome",
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
		const narrow = Effect.fn("diagramGeneration.familyNarrowing")(function* (request: string) {
			const result = yield* narrowByRankAndRecheck(request, options.timeoutMs).pipe(
				Effect.provideService(DecisionModel.DecisionModel, model),
				Effect.catch((error): Effect.Effect<FamilyNarrowing> =>
					Effect.succeed({ _tag: "Failed", error: error.message }),
				),
			);
			yield* Effect.annotateCurrentSpan(SpanContent.output, result);
			yield* recordMetric(narrowings, 1, {
				operation: "generate",
				outcome:
					result._tag === "Narrowed"
						? result.families.length === 1
							? "one"
							: "several"
						: result._tag === "Unnarrowed"
							? "unnarrowed"
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

/** The `maxFamilies` options a Choice ranks highest, in the order the options are listed. */
function bestOptions(choice: Readonly<Record<string, number>>): FamilyOptionName[] {
	const best = [...FAMILY_OPTION_NAMES]
		.sort((a, b) => (choice[b] ?? 0) - (choice[a] ?? 0))
		.slice(0, maxFamilies);
	return FAMILY_OPTION_NAMES.filter((option) => best.includes(option));
}

/**
 * Rank every option, then re-check the best three with what each draws and is not for. A
 * ranking can be sure and still wrong between two near kinds, so even a sure one is re-checked.
 */
const narrowByRankAndRecheck = Effect.fnUntraced(function* (
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
		return { _tag: "Unnarrowed", reason: "no kind fits", shortlist: [] };
	}
	const shortlist = bestOptions(distributionOf(ranked, "which"));
	const rechecked = yield* withTimeout(
		askJev("recheck", request, {
			which: whichOfShortlistQuestion(shortlist),
			...Object.fromEntries(
				shortlist.map((option) => [`fits::${option}`, kindFitsQuestion(option)]),
			),
		}),
		timeoutMs,
	);
	const fits = new Map(
		shortlist.map((option) => [option, probabilityOf(rechecked, `fits::${option}`)]),
	);
	if ([...fits.values()].every((p) => p < no)) {
		return { _tag: "Unnarrowed", reason: "no shortlisted kind fits", shortlist };
	}
	return { ...decideFamilies(distributionOf(rechecked, "which"), fits, "re-check"), shortlist };
});

/**
 * Narrowing by Jev on Workers AI, through the Worker's own AI binding. The call does not retry:
 * a rate limit or any other error narrows nothing, so generation waits for no backoff.
 */
export const workersAiFamilyNarrowingLayer = (options: {
	readonly ai: WorkersAiRunner;
	readonly timeoutMs?: number;
}): Layer.Layer<DiagramFamilyNarrowing> =>
	Layer.effect(
		DiagramFamilyNarrowing,
		makeDiagramFamilyNarrowing({ timeoutMs: options.timeoutMs ?? 3_000 }),
	).pipe(Layer.provide(workersAiJevLayer({ ai: options.ai, model: FAMILY_NARROWING_MODEL })));
