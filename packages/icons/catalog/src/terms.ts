import commonWordsJson from "./generated/common-words.json" with { type: "json" };

/**
 * Generic technical words in catalog terms that the SCOWL list lacks or ranks
 * as uncommon ("api", "onboarding", "observability"). They are treated like
 * English words: alone, they never name a product unless cased as a name.
 */
const COMMON_TECH_WORDS = [
	"antigravity",
	"api",
	"dataflow",
	"datastore",
	"datastream",
	"filestore",
	"genomics",
	"json",
	"memorystore",
	"meta",
	"nitro",
	"observability",
	"onboarding",
	"ontology",
	"profiler",
	"pubsub",
	"pwa",
	"remix",
	"serverless",
	"submodel",
	"turbo",
];

/**
 * Catalog-term words that are common English (SCOWL size 50, generated with
 * the catalog) or generic technical words. "Linear", "Render", "Stream", and
 * "Segment" are products, but in prose they are usually just words.
 */
const COMMON_WORDS: ReadonlySet<string> = new Set([...commonWordsJson, ...COMMON_TECH_WORDS]);

const WORD = /[A-Za-z0-9.+#]+/gu;

/** Words of free text, without sentence dots ("Docker." is "Docker"). */
export function wordsOf(segment: string): string[] {
	return [...segment.matchAll(WORD)]
		.map(([word]) => word.replace(/^\.+|\.+$/gu, ""))
		.filter(Boolean);
}

/** Word tokens lowercased, as catalog terms are indexed. */
export function termTokens(value: string): string[] {
	return wordsOf(value).map((word) => word.toLocaleLowerCase());
}

/**
 * A lowercased word that could only be a name: it has digits or punctuation
 * ("k8s", "next.js"), or it is not a common word ("docker", "kubernetes").
 */
export function isDistinctiveWord(lower: string): boolean {
	return /[0-9.+#]/u.test(lower) || (lower.length >= 3 && !COMMON_WORDS.has(lower));
}
