/** Finite flowchart lemmas and catalog aliases; no suffix guessing or fuzzy matching. */
const WORD_ALIASES = new Map([
	["comms", "communications"],
	["rollback", "roll back"],
	["retesting", "retest"],
	["classifies", "classify"],
	["refunded", "refund"],
	["rejected", "reject"],
	["returns", "return"],
	["triaged", "triage"],
	["alarms", "alarm"],
	["declared", "declare"],
	["monitoring", "monitor"],
	["escalates", "escalate"],
	["parsing", "parse"],
	["parsed", "parse"],
	["suppliers", "supplier"],
	["exceptions", "exception"],
	["matches", "match"],
	["limits", "limit"],
	["deduplicates", "deduplicate"],
	["importing", "import"],
	["approved", "approve"],
	["approval", "approve"],
	["approves", "approve"],
	["declines", "decline"],
	["retains", "retain"],
	["succeeds", "succeed"],
	["succeeded", "succeed"],
	["pauses", "pause"],
	["extracts", "extract"],
	["drafts", "draft"],
	["reviews", "review"],
	["investigation", "investigate"],
	["exports", "export"],
	["pages", "page"],
	["sent", "send"],
	["verifies", "verify"],
	["inspection", "inspect"],
	["creates", "create"],
	["created", "create"],
	["acknowledges", "acknowledge"],
	["mitigates", "mitigate"],
	["sends", "send"],
	["notified", "notify"],
	["collected", "collect"],
	["matched", "match"],
	["scheduled", "schedule"],
	["enabled", "enable"],
	["internally", "internal"],
	["completes", "complete"],
	["requests", "request"],
	["requested", "request"],
	["collects", "collect"],
	["schedules", "schedule"],
	["accepts", "accept"],
	["escalation", "escalate"],
	["restores", "restore"],
	["successful", "succeed"],
	["resetting", "reset"],
	["resets", "reset"],
	["clicked", "click"],
	["creating", "create"],
	["verified", "verify"],
	["declined", "decline"],
	["retained", "retain"],
	["releases", "release"],
	["quotes", "quote"],
	["seats", "seat"],
	["responds", "respond"],
	["removes", "remove"],
	["keeps", "keep"],
	["runs", "run"],
	["passing", "pass"],
	["deploys", "deploy"],
	["rejects", "reject"],
	["charges", "charge"],
	["retries", "retry"],
	["builds", "build"],
	["receives", "receive"],
	["received", "receive"],
	["returned", "return"],
	["cached", "cache"],
	["stored", "store"],
	["logs", "log"],
	["returning", "return"],
	["verification", "verify"],
	["verifying", "verify"],
	["uploaded", "upload"],
	["uploads", "upload"],
	["uploading", "upload"],
	["payment", "pay"],
	["payments", "pay"],
	["paid", "pay"],
	["pays", "pay"],
	["paying", "pay"],
	["submitted", "submit"],
	["submits", "submit"],
	["submitting", "submit"],
	["submission", "submit"],
	["blocks", "block"],
	["blocked", "block"],
	["deployed", "deploy"],
	["resolved", "resolve"],
	["resolves", "resolve"],
	["resolving", "resolve"],
	["validated", "validate"],
	["validates", "validate"],
	["validation", "validate"],
	["parses", "parse"],
	["checked", "check"],
	["checks", "check"],
	["reviewed", "review"],
	["reviewing", "review"],
	["accepted", "accept"],
	["inspected", "inspect"],
	["inspecting", "inspect"],
	["successfully", "succeed"],
	["packaging", "package"],
	["packaged", "package"],
	["passes", "pass"],
	["passed", "pass"],
	["attached", "attach"],
	["attachment", "attach"],
	["merged", "merge"],
	["merges", "merge"],
	["records", "record"],
	["duplicates", "duplicate"],
	["expenses", "expense"],
	["errors", "error"],
	["invoices", "invoice"],
	["parties", "party"],
	["scans", "scan"],
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
		.flatMap((word) => (WORD_ALIASES.get(word) ?? word).split(" "));
}

const NEGATORS = new Set([
	"not",
	"no",
	"never",
	"without",
	"cannot",
	"ignore",
	"ignores",
	"ignored",
	"skip",
	"skips",
	"skipped",
	"omit",
	"omits",
	"omitted",
	"fail",
	"fails",
	"failed",
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

const NEGATION_BOUNDARIES = new Set(["and", "or", "then", "but", "so", "otherwise"]);

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
			if (NEGATION_BOUNDARIES.has(word)) segments.push([]);
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
