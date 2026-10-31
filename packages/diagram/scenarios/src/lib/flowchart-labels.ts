/**
 * Derivations, irregular forms, and operator inflections that the regular
 * inflection stemmer below cannot reach. No fuzzy or semantic matching.
 */
const WORD_ALIASES = new Map([
	["fails", "fail"],
	["failed", "fail"],
	["failing", "fail"],
	["ignores", "ignore"],
	["ignored", "ignore"],
	["skips", "skip"],
	["skipped", "skip"],
	["omits", "omit"],
	["omitted", "omit"],
	["comms", "communications"],
	["rollback", "roll back"],
	["approval", "approve"],
	["succeeds", "succeed"],
	["succeeded", "succeed"],
	["investigation", "investigate"],
	["sent", "send"],
	["inspection", "inspect"],
	["internally", "internal"],
	["escalation", "escalate"],
	["successful", "succeed"],
	["verification", "verify"],
	["payment", "pay"],
	["payments", "pay"],
	["paid", "pay"],
	["submission", "submit"],
	["validation", "validate"],
	["successfully", "succeed"],
	["attachment", "attach"],
	// Abbreviations people type for the components they name.
	["alb", "application load balancer"],
	["db", "database"],
	["postgresql", "postgres"],
]);

/** Flowchart-only normalization; sequence and logo matching keep their own rules. */
export function flowchartLabelWords(label: string): string[] {
	return label
		.toLowerCase()
		.replace(
			/\b(?:isn|aren|wasn|weren|don|doesn|didn|hasn|haven|hadn|can|couldn|wouldn|shouldn|won|mustn|needn)['’]t\b/gu,
			"not",
		)
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		.flatMap((word) => (WORD_ALIASES.get(word) ?? word).split(" "))
		.map(inflectionStem);
}

/**
 * Reduce a word to a shared inflection stem in three stages, so singular,
 * plural, past, and gerund forms meet: `exists`/`exist`,
 * `identified`/`identify`, `settings`/`setting`, `cookies`/`cookie`,
 * `uses`/`used`/`using`/`use`. (1) Strip a plural or third-person `-s`,
 * `-es`, or `-ies`. (2) Strip `-ed`, `-ied`, or `-ing`. (3) Turn a final `ie`
 * into `y`, or drop a final silent `e`. A stage that would leave under two
 * letters or produce an operator word is skipped, and later stages stop, so
 * every form of a word stops at the same point. Derivations (`verification`,
 * `payment`) and irregular forms (`sent`, `paid`) stay in WORD_ALIASES, and
 * operator words keep their exact form for the negation rules below.
 */
function inflectionStem(word: string): string {
	if (!/^\p{Ll}+$/u.test(word) || OPERATOR_WORDS.has(word)) return word;
	const stages: readonly ((stem: string) => string)[] = [
		(stem) =>
			stem.endsWith("ies")
				? `${stem.slice(0, -3)}y`
				: /(?:ss|x|z|ch|sh)es$/u.test(stem)
					? stem.slice(0, -2)
					: /[^su]s$/u.test(stem) && !stem.endsWith("is")
						? stem.slice(0, -1)
						: stem,
		(stem) =>
			stem.endsWith("ied")
				? `${stem.slice(0, -3)}y`
				: /[^e]ed$/u.test(stem)
					? undouble(stem.slice(0, -2))
					: stem.endsWith("ing")
						? undouble(stem.slice(0, -3))
						: stem,
		(stem) =>
			stem.endsWith("ie") ? `${stem.slice(0, -2)}y` : stem.endsWith("e") ? stem.slice(0, -1) : stem,
	];
	let stem = word;
	for (const stage of stages) {
		const next = stage(stem);
		if (next.length < 2 || OPERATOR_WORDS.has(next)) break;
		stem = next;
	}
	return stem;
}

/** `stopped` → `stop`, but `rolled`, `passed`, `added`, `staffed` keep their pair. */
function undouble(stem: string): string {
	return /([^aeioulszfd])\1$/u.test(stem) ? stem.slice(0, -1) : stem;
}

// Inflected operators (`failed`, `skips`) reach this set through WORD_ALIASES.
const NEGATORS = new Set([
	"not",
	"no",
	"never",
	"without",
	"cannot",
	"ignore",
	"skip",
	"omit",
	"fail",
	"unable",
]);

const NEGATION_GAPS = new Set([
	"a",
	"an",
	"the",
	"to",
	"be",
	"been",
	"being",
	"is",
	"are",
	"was",
	"were",
	"has",
	"have",
	"had",
	"do",
	"does",
	"did",
	"yet",
	"still",
	"ever",
	"fully",
	"actually",
	"currently",
	"already",
	"eventually",
	"successfully",
	"succeed", // Lemma of "successfully"; retain its auxiliary/adverb gap behavior.
]);

// Keep criterion words (within, before, after), condition words, and negators.
// Removing auxiliaries here never removes them from the negation context below.
const STOPWORDS = new Set([
	"a",
	"an",
	"the",
	"to",
	"of",
	"for",
	"from",
	"in",
	"on",
	"at",
	"by",
	"with",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"has",
	"have",
	"had",
	"do",
	"does",
	"did",
	"and",
	"or",
	"that",
]);

/** Content lemmas, retaining negation and words that state additional work. */
export function flowchartContentWords(label: string): string[] {
	return flowchartLabelWords(label).filter((word) => !STOPWORDS.has(word));
}

const NEGATION_BOUNDARIES = new Set(["and", "or", "then", "but", "so", "otherwise"]);

// A subordinate clause or `without` phrase qualifies the action before it: in
// `Roll back the feature after failed internal checks` the failure negates the
// checks, and in `Decline application without exception approval` the
// `without` negates the approval, not the decline. Neither lifts a negator
// that precedes the required words.
const SUBORDINATORS = new Set(["after", "because", "if", "once", "when"]);
const SEGMENT_STARTS = new Set([...NEGATION_BOUNDARIES, ...SUBORDINATORS, "without"]);

// Operator words keep their exact form: stemming must never turn a content
// word into one of them, nor change an operator the negation rules match.
// `yes` stays whole as the bare branch answer.
const OPERATOR_WORDS = new Set([
	...NEGATORS,
	...NEGATION_GAPS,
	...STOPWORDS,
	...NEGATION_BOUNDARIES,
	...SUBORDINATORS,
	"yes",
]);

/** Every content-word lemma must occur, in any order, without unrequested negation. */
export function flowchartLabelMatches(label: string, alternatives: readonly string[]): boolean {
	let clause = 0;
	let captionGroup = 0;
	let lastWord: string | undefined;
	const tokens = label.split(/([,:;—–→!?()/]|\s-\s|\.(?=\s|$)|\r?\n)/u).flatMap((part) => {
		if (/^(?:[,:;—–→!?()/.]|\s-\s|\r?\n)$/u.test(part)) {
			// A wrap immediately after an operator/auxiliary continues negation.
			const continuation =
				!/[,:;]/u.test(part) &&
				lastWord !== undefined &&
				(NEGATION_GAPS.has(lastWord) ||
					["not", "never", "without", "cannot", "unable"].includes(lastWord));
			if (!continuation) {
				clause += 1;
				if (!/^[,:()]$/u.test(part)) captionGroup += 1;
				lastWord = undefined;
			}
			return [];
		}
		const words = flowchartLabelWords(part);
		return words.map((word) => {
			lastWord = word;
			return { word, clause, captionGroup };
		});
	});
	const clauses = [...new Set(tokens.map((token) => token.clause))].map((clauseId) => {
		const entries = tokens.filter((token) => token.clause === clauseId);
		return { words: entries.map((token) => token.word), group: entries[0]!.captionGroup };
	});
	// Unnegated qualifiers may share a caption across commas, colons, and
	// parentheses. A negated segment interrupts the run; never jump across it.
	const positiveClauses: string[][] = [];
	let caption: string[] | undefined;
	let previousGroup: number | undefined;
	for (const entry of clauses) {
		const segments: string[][] = [[]];
		for (const word of entry.words) {
			if (SEGMENT_STARTS.has(word)) segments.push([]);
			segments.at(-1)!.push(word);
		}
		for (const segment of segments) {
			if (segment.some((word) => NEGATORS.has(word))) {
				caption = undefined;
				continue;
			}
			if (caption === undefined || previousGroup !== entry.group) {
				caption = [];
				positiveClauses.push(caption);
			}
			caption.push(...segment);
			previousGroup = entry.group;
		}
	}
	return alternatives.some((alternative) => {
		const words = flowchartLabelWords(alternative);
		const phrase = [...new Set(words.filter((word) => !STOPWORDS.has(word)))];
		if (phrase.length === 0) return false;
		if (!phrase.some((word) => NEGATORS.has(word))) {
			return positiveClauses.some((clauseWords) =>
				phrase.every((word) => clauseWords.includes(word)),
			);
		}
		// A prompt's negative precondition keeps its operator attached to the
		// immediately governed content word ("not ready", not "ready ... not keep").
		const governedWord = (entries: readonly string[], index: number): string | undefined => {
			const target = entries
				.slice(index + 1)
				.find(
					(word) =>
						NEGATION_BOUNDARIES.has(word) || (!STOPWORDS.has(word) && !NEGATION_GAPS.has(word)),
				);
			return target !== undefined && !NEGATION_BOUNDARIES.has(target) ? target : undefined;
		};
		const preconditions = words.flatMap((word, index) => {
			const target = NEGATORS.has(word) ? governedWord(words, index) : undefined;
			return target === undefined ? [] : [{ operator: word, target }];
		});
		return clauses.some(({ words: clauseWords }) => {
			const explicitNegators = new Set(
				clauseWords.flatMap((word, index) =>
					preconditions.some(
						(condition) =>
							condition.operator === word && condition.target === governedWord(clauseWords, index),
					)
						? [index]
						: [],
				),
			);
			return phrase.every((word) =>
				clauseWords.some((candidate, index) => {
					if (candidate !== word) return false;
					const prefix = clauseWords.slice(0, index);
					// Conjunctions reset negation, but may share a subject within one
					// punctuation-delimited clause ("Item received and inspected").
					const contextStart = prefix.findLastIndex((entry) => NEGATION_BOUNDARIES.has(entry)) + 1;
					let start = Math.max(contextStart, prefix.length - 2);
					while (
						start > contextStart &&
						prefix.slice(start).every((entry) => NEGATION_GAPS.has(entry))
					) {
						start -= 1;
					}
					return !prefix
						.slice(start)
						.some((entry, offset) => NEGATORS.has(entry) && !explicitNegators.has(start + offset));
				}),
			);
		});
	});
}

// Action verbs a step label may drop while keeping the step's object. A
// finite list, so a leading noun (`Nurse triage`, `Monitoring low severity`)
// or a compound (`Same-day appointment`) is never taken for a dropped verb.
const LEADING_ACTION_VERBS = new Set(
	[
		"add",
		"call",
		"check",
		"collect",
		"create",
		"log",
		"match",
		"perform",
		"present",
		"quote",
		"remove",
		"request",
		"return",
		"run",
		"schedule",
		"send",
		"ship",
		"show",
		"store",
		"use",
		"verify",
	].map(inflectionStem),
);

/**
 * An action step may be drawn as the noun phrase left when its leading verb is
 * dropped: `Routine appointment` for `schedules a routine appointment`. The
 * alternative must start with a LEADING_ACTION_VERBS verb followed by at least
 * two plain object words, and the label's content words must be exactly
 * those object words, in any order. A question (`Is the answer cached?`), a
 * lone noun (`Appointment`), a different verb (`Cancel routine appointment`),
 * extra words, and negation all fail.
 */
export function flowchartObjectPhraseMatches(
	label: string,
	alternatives: readonly string[],
): boolean {
	if (label.includes("?")) return false;
	const labelWords = new Set(flowchartLabelWords(label).filter((word) => !STOPWORDS.has(word)));
	return alternatives.some((alternative) => {
		const [verb, ...object] = flowchartLabelWords(alternative).filter(
			(word) => !STOPWORDS.has(word),
		);
		const phrase = new Set(object);
		return (
			verb !== undefined &&
			LEADING_ACTION_VERBS.has(verb) &&
			phrase.size >= 2 &&
			!object.some((word) => OPERATOR_WORDS.has(word)) &&
			labelWords.size === phrase.size &&
			[...phrase].every((word) => labelWords.has(word))
		);
	});
}

// A comparison criterion's opposite side: `Under` answers no to `Amount over threshold?`.
const COMPARATOR_OPPOSITES: ReadonlyMap<string, readonly string[]> = new Map(
	(
		[
			["over", ["under", "below"]],
			["under", ["over", "above"]],
			["above", ["below", "under"]],
			["below", ["above", "over"]],
			["more", ["less", "fewer"]],
			["less", ["more", "greater"]],
			["fewer", ["more"]],
			["greater", ["less", "smaller"]],
		] as const
	).map(([word, opposites]) => [inflectionStem(word), opposites.map(inflectionStem)]),
);

/**
 * A yes/no branch may restate its decision's criterion instead of answering
 * yes or no: `Healthy`, `Not healthy` or `Unhealthy` for `Canary healthy?`;
 * `Pass` or `Fail` for `Tests pass?`; `Over` or `Under` for `Amount over
 * threshold?`. Every content word must come from the criterion, and the
 * caption must carry the outcome: the criterion's predicate (its last content
 * word, `healthy`), its comparator (`over`) or, for "no", `fail` or the
 * comparator's opposite (`under`). A subject alone (`Canary`) states no
 * outcome. A "no" restatement has exactly one negation (a negator, an
 * un-/in- prefixed predicate or an opposite comparator); a "yes" one has
 * none. Double negations (`Not failed`, `Not unhealthy`) are rejected rather
 * than composed.
 */
export function flowchartBranchRestates(
	label: string,
	criterion: string,
	answer: "yes" | "no",
): boolean {
	const criterionWords = flowchartLabelWords(criterion).filter((word) => !STOPWORDS.has(word));
	const predicate = criterionWords.at(-1);
	const words = flowchartLabelWords(label).filter((word) => !STOPWORDS.has(word));
	if (predicate === undefined || words.length === 0) return false;
	let negations = 0;
	let outcome = false;
	for (const word of words) {
		if (NEGATORS.has(word)) {
			negations += 1;
			if (word === "fail") outcome = true;
		} else if (/^(?:un|in)/u.test(word) && word.slice(2) === predicate) {
			negations += 1;
			outcome = true;
		} else if (criterionWords.includes(word)) {
			if (word === predicate || COMPARATOR_OPPOSITES.has(word)) outcome = true;
		} else if (
			criterionWords.some((criterionWord) =>
				COMPARATOR_OPPOSITES.get(criterionWord)?.includes(word),
			)
		) {
			negations += 1;
			outcome = true;
		} else return false;
	}
	return outcome && negations === (answer === "no" ? 1 : 0);
}
