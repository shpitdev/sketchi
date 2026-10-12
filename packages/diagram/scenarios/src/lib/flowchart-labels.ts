/** Deliberate catalog aliases, not a general-purpose stemmer or fuzzy matcher. */
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
	["builds", "build"],
	["receives", "receive"],
	["received", "receive"],
	["returned", "return"],
	["cached", "cache"],
	["stored", "store"],
	["logs", "log"],
	["returning", "return"],
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
]);

/** Whole-word alternatives ignore punctuation, but not adjacent negation. */
export function flowchartLabelMatches(label: string, alternatives: readonly string[]): boolean {
	let clause = 0;
	let lastWord: string | undefined;
	const tokens = label.split(/([,:;—–→!?()/]|\s-\s|\.(?=\s|$)|\r?\n)/u).flatMap((part) => {
		if (/^(?:[,:;—–→!?()/.]|\s-\s|\r?\n)$/u.test(part)) {
			// A wrap immediately after an operator/auxiliary continues negation.
			const continuation =
				lastWord !== undefined &&
				(NEGATION_GAPS.has(lastWord) ||
					["not", "never", "without", "cannot", "unable"].includes(lastWord));
			if (!continuation) {
				clause += 1;
				lastWord = undefined;
			}
			return [];
		}
		const words = flowchartLabelWords(part);
		return words.map((word) => {
			lastWord = word;
			const entry = { word, clause };
			if (["and", "or", "then", "but", "so", "otherwise"].includes(word)) clause += 1;
			return entry;
		});
	});
	return alternatives.some((alternative) => {
		const phrase = flowchartLabelWords(alternative);
		if (phrase.length === 0) return false;
		return tokens.some((token, index) => {
			if (!phrase.every((word, offset) => tokens[index + offset]?.word === word)) return false;
			const prefix = tokens.slice(0, index).filter((entry) => entry.clause === token.clause);
			let start = Math.max(0, prefix.length - 2);
			while (start > 0 && prefix.slice(start).every((entry) => NEGATION_GAPS.has(entry.word))) {
				start -= 1;
			}
			return !prefix.slice(start).some((entry) => NEGATORS.has(entry.word));
		});
	});
}
