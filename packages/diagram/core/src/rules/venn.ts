import { VENN_COLOR_NAMES } from "../types/venn.js";
import type { RuleSource } from "./source.js";

const palette = `a palette name (${VENN_COLOR_NAMES.join(", ")}) or #rrggbb`;

/** How a request becomes a Venn diagram; see FLOWCHART_RULES. */
export const VENN_RULES = {
	regions:
		'A region\'s sets are the ids it lies in, and it excludes every other set: ["a"] is a only, ["a", "b"] is a and b but not c.',
	/** The execute code parameter's form of `regions` and `contents`. */
	regionsCompact:
		'A region lies in exactly its sets: ["a"] is a only, ["a", "b"] is a and b but not c. Omit empty regions.',
	contents: (source: RuleSource) =>
		`Give a region items (short phrases) or a count, never both. Omit a region ${source} leaves empty; label names an overlap only when ${source} does.`,
	placement: "Put each item once, in exactly its region.",
	color: `color is ${palette}.`,
	colorWhenStated: (source: RuleSource) =>
		`Set a set's color only when ${source} names one: ${palette}.`,
	copy: (source: RuleSource) =>
		`Copy every set and item ${source} states, each once and in exactly its region; invent none.`,
} as const;
