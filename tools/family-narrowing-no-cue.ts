/**
 * Rewords a request so it names no diagram family, for the family-narrowing eval's
 * no-cue set. The rules are general: they know nothing about any scenario.
 *
 * 1. Every phrase the word router reads as naming a family (FAMILY_NAMES) is replaced:
 *    by "chart" when its last word is chart, graph or plot, otherwise by "diagram",
 *    keeping a plural.
 * 2. A phrase used as a verb, followed by an object such as "a", "the" or "it", becomes
 *    "draw" instead.
 * 3. A replacement beside another generic noun merges into it: "Venn diagram" and
 *    "swimlane flowchart" become "diagram", "Eisenhower matrix" becomes "matrix".
 * 4. "an" before a replacement becomes "a". A replacement is capitalized only where it
 *    starts a sentence that started with a capital.
 */
import { FAMILY_NAMES } from "@sketchi/diagram-generation";

const OBJECT_WORDS = /^\s+(?:a|an|the|it|this|these|that|our|my|your|their)\b/iu;
const GENERIC_NOUN = /^(?:diagram|chart|map|matrix|graph|plot)s?$/iu;
const CHART_ENDING = /(?:^|[\s-])(?:chart|graph|plot)s?$/iu;

interface Replacement {
	readonly end: number;
	readonly start: number;
	readonly text: string;
}

function replacementFor(phrase: string, after: string): string {
	if (OBJECT_WORDS.test(after)) return "draw";
	const plural = /s$/iu.test(phrase) && !/ss$/iu.test(phrase);
	const noun = CHART_ENDING.test(phrase) ? "chart" : "diagram";
	return plural ? `${noun}s` : noun;
}

function familyPhrases(request: string): Replacement[] {
	const found: Replacement[] = [];
	for (const pattern of Object.values(FAMILY_NAMES)) {
		const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
		for (const match of request.matchAll(global)) {
			const start = match.index;
			const end = start + match[0].length;
			found.push({ end, start, text: replacementFor(match[0], request.slice(end)) });
		}
	}
	// Keep the longest phrase where two overlap ("UML class" inside "UML class diagram").
	found.sort((a, b) => a.start - b.start || b.end - a.end);
	const kept: Replacement[] = [];
	for (const replacement of found) {
		const last = kept.at(-1);
		if (last && replacement.start < last.end) continue;
		kept.push(replacement);
	}
	return kept;
}

const SENTENCE_START = /(?:^|[.!?]\s+|\n\s*)$/u;

/** A capital only where the phrase it replaces began a sentence with one. */
function matchCase(original: string, replacement: string, before: string): string {
	const first = original.charAt(0);
	return first !== first.toLowerCase() && SENTENCE_START.test(before)
		? replacement.charAt(0).toUpperCase() + replacement.slice(1)
		: replacement;
}

/** The request with every family name removed by the rules above. */
export function withoutFamilyNames(request: string): string {
	let text = request;
	// Right to left, so earlier offsets stay valid.
	for (const { end, start, text: replacement } of familyPhrases(request).reverse()) {
		const before = text.slice(0, start);
		text = `${before}${matchCase(text.slice(start, end), replacement, before)}${text.slice(end)}`;
	}
	return mergeGenericNouns(text).replace(
		/\b([Aa])n (?=(?:diagram|chart|draw|map|matrix|graph|plot)s?\b)/giu,
		"$1 ",
	);
}

/** "diagram diagram", "diagram chart" and "diagram matrix" become the last noun. */
function mergeGenericNouns(text: string): string {
	return text.replace(
		/\b(diagram|chart)s?([ -]+)([A-Za-z]+)\b/giu,
		(whole, first: string, _gap: string, next: string, offset: number, all: string) =>
			GENERIC_NOUN.test(next) ? matchCase(first, next.toLowerCase(), all.slice(0, offset)) : whole,
	);
}
