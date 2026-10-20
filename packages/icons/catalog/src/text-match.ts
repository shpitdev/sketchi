import { searchIcons, type SearchableIcon } from "./search.js";
import { isDistinctiveWord, termTokens, wordsOf } from "./terms.js";

/** Most catalog terms a prompt can offer one diagram. */
export const MAX_TEXT_ICON_MATCHES = 24;
const MAX_PHRASE_TOKENS = 4;

/** One word of free text, with the context that decides how much it says. */
interface TextToken {
	readonly lower: string;
	readonly raw: string;
	/** First word of a sentence, line, or clause after a colon. */
	readonly initial: boolean;
	/** Inside a Title Case line, where capitals carry no signal. */
	readonly titleCase: boolean;
}

/** A catalog icon named in text. */
export interface IconMention<Icon extends SearchableIcon = SearchableIcon> {
	readonly icon: Icon;
	/**
	 * True when the words could only be the product: a non-dictionary name
	 * ("Docker", "kubernetes"), a token with digits or punctuation ("k8s",
	 * "next.js"), or a camel-cased brand ("GitHub"). False when the mention is
	 * an everyday word that only its capitalization marks as a name ("we use
	 * Go", "tickets in Linear").
	 */
	readonly distinctive: boolean;
}

const SEGMENT_BREAK = /(?<=[.!?:])\s+|\n+/u;
function isCapitalized(word: string): boolean {
	return /^[A-Z]/u.test(word) && /[a-z]/u.test(word);
}

/** Every longer word is capitalized ("Look Up User ID", "Deploy With Go"). */
function isTitleCase(words: readonly string[]): boolean {
	const capitalized = words.filter(isCapitalized).length;
	return capitalized >= 2 && words.every((word) => !/^[a-z]/u.test(word) || word.length <= 3);
}

function tokenize(text: string): TextToken[] {
	return text.split(SEGMENT_BREAK).flatMap((segment) => {
		const words = wordsOf(segment);
		const titleCase = isTitleCase(words);
		return words.map((raw, index) => ({
			lower: raw.toLocaleLowerCase(),
			raw,
			initial: index === 0,
			titleCase,
		}));
	});
}

function isDistinctive(token: TextToken): boolean {
	return /[a-z][A-Z]/u.test(token.raw) || isDistinctiveWord(token.lower);
}

/** A capitalized everyday word, where capitals can only mean a name. */
function isCasedAsName(token: TextToken): boolean {
	return !token.initial && !token.titleCase && isCapitalized(token.raw);
}

const termIndexes = new WeakMap<readonly SearchableIcon[], Map<string, SearchableIcon[]>>();

/** Icons by tokenized slug, name, and alias, built once per icon list. */
function termIndex<Icon extends SearchableIcon>(icons: readonly Icon[]): Map<string, Icon[]> {
	const cached = termIndexes.get(icons);
	if (cached) return cached as Map<string, Icon[]>;
	const index = new Map<string, Icon[]>();
	const add = (term: string, icon: Icon) => {
		const key = termTokens(term).join(" ");
		if (!key) return;
		const entries = index.get(key) ?? [];
		if (!entries.includes(icon)) entries.push(icon);
		index.set(key, entries);
	};
	for (const icon of icons) {
		add(icon.slug.replaceAll("-", " "), icon);
		add(icon.name, icon);
		for (const alias of icon.aliases) add(alias, icon);
	}
	termIndexes.set(icons, index);
	return index;
}

/**
 * Catalog icons named in free text, in order of first mention. Each phrase is
 * the longest run of up to four words matching an icon's slug, name, or
 * alias; when several icons share a phrase, the ranked search breaks the tie.
 * Everyday words count only when cased as a name mid-sentence, so "stream
 * events" or "Sync Order" name nothing while "tickets in Linear" names Linear.
 * Deterministic for a given text and icon list.
 */
export function matchIconMentions<Icon extends SearchableIcon>(
	text: string,
	icons: readonly Icon[],
	limit = MAX_TEXT_ICON_MATCHES,
): IconMention<Icon>[] {
	const index = termIndex(icons);
	const tokens = tokenize(text);
	const mentions: IconMention<Icon>[] = [];
	const seen = new Map<string, number>();
	for (let start = 0; start < tokens.length && mentions.length < limit;) {
		let matched = 0;
		for (let length = Math.min(MAX_PHRASE_TOKENS, tokens.length - start); length > 0; length -= 1) {
			const phraseTokens = tokens.slice(start, start + length);
			const entries = index.get(phraseTokens.map((token) => token.lower).join(" "));
			if (!entries) continue;
			const distinctive = phraseTokens.some(isDistinctive);
			if (!distinctive && !phraseTokens.some(isCasedAsName)) continue;
			const best = searchIcons(entries, {
				query: phraseTokens.map((token) => token.lower).join(" "),
			})[0]?.icon;
			const earlier = best ? seen.get(best.slug) : undefined;
			if (best && earlier === undefined) {
				seen.set(best.slug, mentions.length);
				mentions.push({ icon: best, distinctive });
			} else if (best && distinctive && earlier !== undefined) {
				// A later unmistakable mention settles an earlier ambiguous one.
				mentions[earlier] = { icon: best, distinctive };
			}
			matched = length;
			break;
		}
		start += Math.max(1, matched);
	}
	return mentions;
}

/** Catalog icons named in free text, in order of first mention. */
export function matchIconsInText<Icon extends SearchableIcon>(
	text: string,
	icons: readonly Icon[],
	limit = MAX_TEXT_ICON_MATCHES,
): Icon[] {
	return matchIconMentions(text, icons, limit).map(({ icon }) => icon);
}

/**
 * The one catalog logo a node label unmistakably names ("Ship to Cloudflare
 * Workers" names cloudflare), or nothing when it names no product, several
 * ("Next.js page (Vercel)"), or one only by an everyday word ("Go to
 * checkout", "Log errors to Sentry").
 */
export function logoNamedByLabel<Icon extends SearchableIcon>(
	label: string,
	icons: readonly Icon[],
): Icon | undefined {
	const [mention, ...others] = matchIconMentions(label, icons, 2);
	return mention?.distinctive && others.length === 0 ? mention.icon : undefined;
}

/** A logo a text names, as generation offers it to a model. */
export interface NamedLogo {
	readonly aliases?: readonly string[];
	/** The catalog collection, which marks cloud vendors (see isVendorLogo). */
	readonly collection: string;
	readonly name: string;
	readonly slug: string;
}

/**
 * The logos a text names, in order of mention, with the aliases placement
 * matches labels against. `/api/v1/generate`, Studio chat, and the scenario
 * evals all offer exactly this list.
 */
export function logosNamedInText(text: string, icons: readonly SearchableIcon[]): NamedLogo[] {
	return matchIconsInText(text, icons).map((icon) => ({
		...(icon.aliases.length > 0 ? { aliases: icon.aliases } : {}),
		collection: icon.collection,
		name: icon.name,
		slug: icon.slug,
	}));
}
