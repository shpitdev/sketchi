import { searchIcons, type SearchableIcon } from "./search.js";
import {
	isDistinctiveWord,
	isEnglishWord,
	isGenericTechWord,
	termTokens,
	wordsOf,
} from "./terms.js";

/** Most catalog terms a prompt can offer one diagram. */
export const MAX_TEXT_ICON_MATCHES = 24;

/** One word of free text, with the context that decides how much it says. */
interface TextToken {
	readonly lower: string;
	readonly raw: string;
	/** First word of a sentence, line, or clause after a colon. */
	readonly initial: boolean;
	/** Inside a Title Case line, where capitals carry no signal. */
	readonly titleCase: boolean;
	/** Inside parentheses: "Next.js page (Vercel)". */
	readonly enclosed: boolean;
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
	/**
	 * True when only being the capitalized first word of a label made an English word a name
	 * ("Python worker", "Sync the order"), which counts only where a diagram asks for logos.
	 */
	readonly labelInitial?: boolean;
	/** The lowercased word after a label-initial mention ("app" in "React app"), if any. */
	readonly nextWord?: string;
	/**
	 * True when the text names the product as where something else runs: after "on", "to", "in"
	 * or another such word ("app hosted on Vercel"), in parentheses ("page (Vercel)"), or before
	 * "hosted" or "based" ("Vercel-hosted page").
	 */
	readonly platform?: boolean;
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
		// Where each word starts, to tell whether it sits inside parentheses.
		let from = 0;
		return words.map((raw, index) => {
			const at = segment.indexOf(raw, from);
			from = at < 0 ? from : at + raw.length;
			const before = segment.slice(0, Math.max(0, at));
			return {
				lower: raw.toLocaleLowerCase(),
				raw,
				initial: index === 0,
				titleCase,
				enclosed: before.lastIndexOf("(") > before.lastIndexOf(")"),
			};
		});
	});
}

/** Words that put the product after them as where something runs or goes: "on Vercel". */
const PLATFORM_BEFORE: ReadonlySet<string> = new Set([
	"at",
	"atop",
	"behind",
	"from",
	"in",
	"into",
	"on",
	"onto",
	"over",
	"through",
	"to",
	"using",
	"via",
	"with",
]);
/** Participles whose "by" names where something runs: "hosted by Supabase", "run by Cloudflare". */
const PASSIVE_BY: ReadonlySet<string> = new Set([
	"backed",
	"hosted",
	"managed",
	"operated",
	"powered",
	"provided",
	"run",
	"served",
]);
/** Words that make the product before them where something runs: "Vercel-hosted". */
const PLATFORM_AFTER: ReadonlySet<string> = new Set([
	"backed",
	"based",
	"hosted",
	"managed",
	"powered",
]);

function isDistinctive(token: TextToken): boolean {
	return /[a-z][A-Z]/u.test(token.raw) || isDistinctiveWord(token.lower);
}

/** A capitalized everyday word, where capitals can only mean a name. */
function isCasedAsName(token: TextToken): boolean {
	return !token.initial && !token.titleCase && isCapitalized(token.raw);
}

/**
 * A phrase as the term index keys it: lowercased words, a dot inside a name dropped, so
 * "Vue.js" finds the catalog's "Vuejs" and "socket.io" its "socketio". A dot between single
 * letters stays, so "i.e." never reads as "ie".
 */
function phraseKey(words: readonly string[]): string {
	return words.map((word) => word.replace(/(?<=[a-z0-9]{2})\.(?=[a-z0-9]{2})/gu, "")).join(" ");
}

/** The catalog's terms as free text is matched against them. */
interface TermIndex<Icon> {
	readonly icons: Map<string, Icon[]>;
	/** Words in the longest term, so a vendor's full product name is one phrase. */
	readonly longest: number;
	/** One-word terms the catalog writes in capitals ("ALB", "SQS"), keyed as phrases. */
	readonly acronyms: ReadonlySet<string>;
}

const termIndexes = new WeakMap<readonly SearchableIcon[], TermIndex<SearchableIcon>>();

/** Product-qualified aliases disambiguate names that are also ordinary words. */
const QUALIFIED_PRODUCT_TERMS: ReadonlySet<string> = new Set([
	"plaid api",
	"honeycomb tracing",
	"honeycomb observability",
	"tableau dashboard",
	"dbt models",
	"dbt core",
	"dbt cloud",
]);

/**
 * A term spelled in capitals, such as "ALB" or "EC2": in capitals in text, it
 * is that name. Generic technical acronyms ("API", "JSON") never are.
 */
function isAcronym(term: string): boolean {
	return (
		/^[A-Z0-9]+$/u.test(term) &&
		/[A-Z].*[A-Z]/u.test(term) &&
		!isGenericTechWord(term.toLowerCase())
	);
}

/**
 * Diagram tools and notations. A request to Sketchi that names one ("an Excalidraw diagram",
 * "convert this Mermaid flowchart", "a UML class diagram") names the drawing's format or source,
 * not a component to draw, so text never names their marks; a document can still attach one by
 * slug.
 */
const DIAGRAM_MEDIUM_SLUGS: ReadonlySet<string> = new Set([
	"diagramsdotnet",
	"excalidraw",
	"lucid",
	"mermaid",
	"tldraw",
	"uml",
]);

/** Icons by tokenized slug, name, and alias, built once per icon list. */
function termIndex<Icon extends SearchableIcon>(icons: readonly Icon[]): TermIndex<Icon> {
	const cached = termIndexes.get(icons);
	if (cached) return cached as TermIndex<Icon>;
	const index = new Map<string, Icon[]>();
	const acronyms = new Set<string>();
	let longest = 1;
	const add = (term: string, icon: Icon) => {
		const words = termTokens(term);
		const key = phraseKey(words);
		// This short token also names a therapy; require a qualified product alias.
		if (!key || (icon.slug === "dbt" && words.length === 1)) return;
		longest = Math.max(longest, words.length);
		if (isAcronym(term)) acronyms.add(key);
		const entries = index.get(key) ?? [];
		if (!entries.includes(icon)) entries.push(icon);
		index.set(key, entries);
	};
	for (const icon of icons) {
		if (DIAGRAM_MEDIUM_SLUGS.has(icon.slug)) continue;
		add(icon.slug.replaceAll("-", " "), icon);
		add(icon.name, icon);
		for (const alias of icon.aliases) add(alias, icon);
	}
	const built = { icons: index, longest, acronyms };
	termIndexes.set(icons, built);
	return built;
}

/**
 * Catalog icons named in free text, in order of first mention. Each phrase is
 * the longest run of words matching an icon's slug, name, or alias, up to the
 * longest term ("Amazon Managed Streaming for Apache Kafka"); when several icons
 * share a phrase, the ranked search breaks the tie. Everyday words count only
 * when cased as a name: mid-sentence, so "stream events" or "Sync Order" name
 * nothing while "tickets in Linear" names Linear, or in the capitals the catalog
 * writes an acronym in, so "ALB" names the load balancer and "alb" nothing.
 * Deterministic for a given text and icon list.
 */
export function matchIconMentions<Icon extends SearchableIcon>(
	text: string,
	icons: readonly Icon[],
	limit = MAX_TEXT_ICON_MATCHES,
	options: {
		/** Count a capitalized first word too, as a label in a diagram that asks for logos. */
		readonly labelInitial?: boolean;
		/**
		 * Slugs whose everyday-word name counts however the text writes it: the request names
		 * that product and never uses the word otherwise (see NamedLogo.alwaysNamed).
		 */
		readonly alwaysNamed?: ReadonlySet<string>;
	} = {},
): IconMention<Icon>[] {
	const { icons: index, longest, acronyms } = termIndex(icons);
	const tokens = tokenize(text);
	const mentions: IconMention<Icon>[] = [];
	const seen = new Map<string, number>();
	for (let start = 0; start < tokens.length && mentions.length < limit;) {
		let matched = 0;
		for (let length = Math.min(longest, tokens.length - start); length > 0; length -= 1) {
			const phraseTokens = tokens.slice(start, start + length);
			const key = phraseKey(phraseTokens.map((token) => token.lower));
			const entries = index.get(key);
			if (!entries) continue;
			const acronym =
				phraseTokens.length === 1 && acronyms.has(key) && isAcronym(phraseTokens[0]!.raw);
			const distinctive =
				acronym || QUALIFIED_PRODUCT_TERMS.has(key) || phraseTokens.some(isDistinctive);
			// A product the request names by an everyday word it never uses otherwise is that
			// product here, however the phrase is cased; its name counts, not a looser alias.
			const cased =
				phraseTokens.some(isCasedAsName) ||
				entries.some(
					(icon) =>
						options.alwaysNamed?.has(icon.slug) === true &&
						phraseKey(termTokens(icon.name)) === key,
				);
			const first = phraseTokens[0];
			const labelInitial =
				!distinctive &&
				!cased &&
				options.labelInitial === true &&
				start === 0 &&
				first !== undefined &&
				isCapitalized(first.raw);
			if (!distinctive && !cased && !labelInitial) continue;
			const best = searchIcons(entries, {
				query: phraseTokens.map((token) => token.lower).join(" "),
			})[0]?.icon;
			const earlier = best ? seen.get(best.slug) : undefined;
			if (best && earlier === undefined) {
				seen.set(best.slug, mentions.length);
				const nextWord = labelInitial ? tokens[start + length]?.lower : undefined;
				const before = tokens[start - 1]?.lower ?? "";
				const after = tokens[start + length]?.lower ?? "";
				// "Vercel-hosted" and "on Vercel" name the platform; so does "hosted by Supabase", while
				// the name before that clause ("Postgres hosted by Supabase") is the product.
				const passive = tokens[start + length + 1]?.lower === "by";
				const platform =
					first?.enclosed === true ||
					PLATFORM_BEFORE.has(before) ||
					(before === "by" && PASSIVE_BY.has(tokens[start - 2]?.lower ?? "")) ||
					(PLATFORM_AFTER.has(after) && !passive);
				mentions.push({
					icon: best,
					distinctive,
					...(labelInitial ? { labelInitial } : {}),
					...(nextWord ? { nextWord } : {}),
					...(platform ? { platform } : {}),
				});
			} else if (best && distinctive && earlier !== undefined) {
				// A later unmistakable mention settles an earlier ambiguous one.
				const { platform } = mentions[earlier] ?? {};
				mentions[earlier] = { icon: best, distinctive, ...(platform ? { platform } : {}) };
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

/** The logos a node label names, for a diagram that asks for logos. */
export interface LabelLogos<Icon extends SearchableIcon = SearchableIcon> {
	/**
	 * Every catalog logo the label names: the products it is before the platforms they run on
	 * ("Vercel-hosted Next.js page" names nextjs, then vercel), unmistakable names first, then
	 * names an English word carries only by its capitals ("Log errors to Sentry", "Python
	 * worker"). The diagram draws the first.
	 */
	readonly named: readonly Icon[];
	/**
	 * A product an English first word may mean when the label reads as a step ("Make payment",
	 * "Sync the order"); it draws nothing unless an icon names it.
	 */
	readonly possible: readonly Icon[];
}

/** Words that, after an English first word, show the label names software ("React app"). */
const TECH_NOUNS: ReadonlySet<string> = new Set(
	[
		"api",
		"app",
		"backend",
		"bot",
		"broker",
		"bucket",
		"cache",
		"client",
		"cluster",
		"database",
		"frontend",
		"function",
		"gateway",
		"job",
		"pipeline",
		"queue",
		"sdk",
		"server",
		"service",
		"topic",
		"webhook",
		"worker",
	].flatMap((noun) => [noun, `${noun}s`]),
);

/**
 * Marks a tech noun never rescues. Cloud vendors' generic service marks ("Storage",
 * "Compute", "Batch", "Glue") would read "Storage service" as that one product, and some
 * English words name a generic technology before a tech noun ("Edge function", "Stream
 * worker", "Sync function"). Nor does a label that is only the word: a node called "Batch"
 * or "Home" names a step or a page, not a cloud vendor's product.
 */
const GENERIC_COLLECTIONS: ReadonlySet<string> = new Set([
	"aws",
	"aws-resources",
	"databricks",
	"gcp",
	"gcp-products",
	"snowflake",
]);
const GENERIC_TECH_SLUGS: ReadonlySet<string> = new Set([
	"automatic",
	"edge",
	"processing",
	"stream",
	"sync",
]);

/** A cloud vendor's generic service mark ("Storage", "Batch") or a generic technology ("Edge"). */
function isGenericMark(icon: SearchableIcon): boolean {
	return GENERIC_COLLECTIONS.has(icon.collection) || GENERIC_TECH_SLUGS.has(icon.slug);
}

/**
 * Whether an English first word names the product: the label is only the name ("Python"), or
 * a tech noun follows it ("React app", "Spring service").
 */
function namesProduct(mention: IconMention): boolean {
	const generic = GENERIC_COLLECTIONS.has(mention.icon.collection);
	if (mention.nextWord === undefined)
		return !(generic && isEnglishWord(mention.icon.name.toLowerCase()));
	return TECH_NOUNS.has(mention.nextWord) && !generic && !GENERIC_TECH_SLUGS.has(mention.icon.slug);
}

/** The logos a node label names, in a diagram that asks for logos. */
export function labelLogos<Icon extends SearchableIcon>(
	label: string,
	icons: readonly Icon[],
	/** Products the request names by an everyday word it never uses otherwise (see NamedLogo.alwaysNamed). */
	alwaysNamed?: ReadonlySet<string>,
): LabelLogos<Icon> {
	const mentions = matchIconMentions(label, icons, MAX_TEXT_ICON_MATCHES, {
		labelInitial: true,
		...(alwaysNamed ? { alwaysNamed } : {}),
	});
	// A first word that is an English word reads as a step unless the label shows it is a name;
	// a name that is no English word ("Kafka", "Kubernetes") is distinctive and always counts.
	const step = (mention: IconMention<Icon>) =>
		mention.labelInitial === true && !namesProduct(mention);
	const names = mentions.filter((mention) => !step(mention));
	return {
		named: primaryFirst(names).map((mention) => mention.icon),
		possible: mentions.filter(step).map((mention) => mention.icon),
	};
}

/**
 * Mentions in the order a label's logo is chosen from: the product the label is before the
 * platform it runs on, then unmistakable names before everyday words cased as names, and a
 * generic product word last. A node
 * draws one logo, the first: "Next.js page on Vercel" and "Vercel-hosted Next.js page" both
 * draw Next.js.
 */
export function primaryFirst<Mention extends IconMention>(mentions: readonly Mention[]): Mention[] {
	// An everyday word that is also a generic product ("Edge function", "Storage service") never
	// outranks an unmistakable name, even the platform's.
	const generic = (mention: Mention) => !mention.distinctive && isGenericMark(mention.icon);
	const rank = (mention: Mention) =>
		generic(mention) ? 4 : (mention.platform ? 2 : 0) + (mention.distinctive ? 0 : 1);
	return [...mentions].sort((left, right) => rank(left) - rank(right));
}

/** A logo a text names, as generation offers it to a model. */
export interface NamedLogo {
	readonly aliases?: readonly string[];
	/** The catalog collection, which marks cloud vendors (see isVendorLogo). */
	readonly collection: string;
	readonly name: string;
	readonly slug: string;
	/**
	 * True when the product's name is an everyday word that the text writes only as the name
	 * ("posts each order to Slack", and no lowercase "slack"). A diagram of that text means the
	 * product wherever a label has the word, so "Slack order post" draws the logo, while a text
	 * that also writes "go live" or "render the page" leaves "Go live" and "Render page" as steps.
	 * Never set on a cloud vendor's generic service mark ("Storage", "Batch").
	 */
	readonly alwaysNamed?: true;
}

/** Whether the text writes one of an icon's terms in lowercase, as an everyday word ("go live"). */
function writesPlainly(tokens: readonly TextToken[], icon: SearchableIcon): boolean {
	return [icon.slug.replaceAll("-", " "), icon.name, ...icon.aliases].some((term) => {
		const words = termTokens(term);
		const key = phraseKey(words);
		return tokens.some((_, start) => {
			const phrase = tokens.slice(start, start + words.length);
			return (
				phrase.length === words.length &&
				phrase.every((token) => token.raw === token.lower) &&
				phraseKey(phrase.map((token) => token.lower)) === key
			);
		});
	});
}

/**
 * The logos a text names, in order of mention, with the aliases placement
 * matches labels against. `/api/v1/generate`, Studio chat, and the scenario
 * evals all offer exactly this list.
 */
export function logosNamedInText(text: string, icons: readonly SearchableIcon[]): NamedLogo[] {
	const tokens = tokenize(text);
	return matchIconsInText(text, icons).map((icon) => ({
		...(icon.aliases.length > 0 ? { aliases: icon.aliases } : {}),
		collection: icon.collection,
		name: icon.name,
		slug: icon.slug,
		...(!termTokens(icon.name).some(isDistinctiveWord) &&
		!isGenericMark(icon) &&
		!writesPlainly(tokens, icon)
			? { alwaysNamed: true as const }
			: {}),
	}));
}
