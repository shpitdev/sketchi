import {
	canvasElementIcon,
	canvasNodeIconBand,
	COMMUNITY_ICON_COLLECTION,
	DRAWN_ICON_COLLECTION,
	drawnIconSlug,
	embedCanvasIcons,
	iconRecipeIssues,
	isCommunityIconSlug,
	isDiagramIconSlug,
	isDrawnIconSlug,
	isIconRecipe,
	type CanvasIconAsset,
	type CanvasSpec,
	type DroppedCanvasIcon,
	type IconRecipe,
} from "@sketchi/diagram-core";
import {
	CONCEPT_COLLECTION,
	iconMatch,
	isNodeLogoEligible,
	isStandaloneWordmark,
	isStrayVendorLogo,
	logoNamedByLabel,
	labelLogos,
	normalizeNodeLogoSvg,
	searchIcons,
	type ConceptIcon,
	type IconMatch,
	type SketchiIcon,
} from "@sketchi/icon-catalog";
import { Effect, Schema } from "effect";

import { cleanToolString } from "../clean-tool-string.js";
import type { CodeModeIssue } from "./contract.js";

/** One catalog mark that diagrams may draw inside a node. */
export interface CodeModeCatalogIcon {
	readonly collection: string;
	readonly name: string;
	readonly slug: string;
}

export class CodeModeIconLoadError extends Schema.TaggedError<CodeModeIconLoadError>()(
	"CodeModeIconLoadError",
	{
		cause: Schema.Defect(),
		message: Schema.String,
		slug: Schema.String,
	},
) {}

/**
 * Node-logo catalog seen by Code Mode. Hosts supply SVG bytes from wherever
 * they keep them (Worker static assets, a bundled CLI map, test fixtures);
 * slug lookup and ranked search always come from the shared icon catalog.
 */
export interface CodeModeIconCatalog {
	/** The eligible node-logo mark for an exact slug. */
	readonly get: (slug: string) => CodeModeCatalogIcon | undefined;
	/**
	 * A wordmark for an exact slug, when this host serves them. Only a
	 * standalone icon draws one; a node's logo never does.
	 */
	readonly wordmark: (slug: string) => CodeModeCatalogIcon | undefined;
	/**
	 * Ranked node-logo search, shared with icons.sketchi.app, each result with
	 * how it answers the query: the product's own mark, its vendor's, or weak.
	 */
	readonly search: (
		query: string,
		limit: number,
	) => readonly (CodeModeCatalogIcon & { readonly match: IconMatch })[];
	/**
	 * Whether a label leaves a vendor or platform mark unexplained: kubernetes
	 * on "Ingress controller", not cloudflare on "Cloudflare Workers". A
	 * product's own mark never is.
	 */
	readonly isStrayVendorLogo: (slug: string, label: string) => boolean;
	/**
	 * The one mark a label unmistakably names ("Ship to Cloudflare Workers"
	 * names cloudflare); none for labels naming no product, several, or one
	 * only by an everyday word ("Go to checkout").
	 */
	readonly logoNamedByLabel: (label: string) => CodeModeCatalogIcon | undefined;
	/**
	 * The marks a label names in a diagram that asks for logos: every one it names, unmistakable
	 * names first ("Next.js app hosted on Vercel" names nextjs, then vercel), and any its first
	 * word may mean when that word starts step labels far more often ("Make payment").
	 */
	readonly labelLogos: (label: string) => {
		readonly named: readonly CodeModeCatalogIcon[];
		readonly possible: readonly CodeModeCatalogIcon[];
	};
	/** Raw SVG source for an eligible mark. */
	readonly loadSvg: (icon: CodeModeCatalogIcon) => Effect.Effect<string, CodeModeIconLoadError>;
	/** The hand-drawn recipe for an eligible mark, when the catalog has one. */
	readonly recipe: (slug: string) => IconRecipe | undefined;
	/**
	 * Where this host's agents look up exact slugs, quoted in unknown_icon
	 * hints: `sketchi.searchIcons({ q })` in Code Mode, the catalog site offline.
	 */
	readonly slugLookup: string;
}

function catalogIcon(icon: SketchiIcon): CodeModeCatalogIcon {
	return { collection: icon.collection, name: icon.name, slug: icon.slug };
}

/** A concept as a search entry; concepts have no SVG source. */
function conceptSearchIcon(concept: ConceptIcon): SketchiIcon {
	return {
		aliases: concept.aliases,
		bytes: 0,
		collection: CONCEPT_COLLECTION,
		// Concepts are drawn by hand in the scene's ink, which follows its theme.
		colorMode: "mono-dark",
		keywords: [],
		name: concept.name,
		slug: concept.slug,
		svgPath: "",
		viewBox: { height: 24, minX: 0, minY: 0, width: 24 },
	};
}

/** Whether a catalog icon is a generic concept, drawn only by hand and never named by a label. */
export function isConceptIcon(icon: Pick<CodeModeCatalogIcon, "collection">): boolean {
	return icon.collection === CONCEPT_COLLECTION;
}

/** Whether an icon is drawn only by its recipe: a concept, community or drawn icon has no SVG. */
function isRecipeOnlyIcon(icon: Pick<CodeModeCatalogIcon, "collection">): boolean {
	return (
		isConceptIcon(icon) ||
		icon.collection === COMMUNITY_ICON_COLLECTION ||
		icon.collection === DRAWN_ICON_COLLECTION
	);
}

/** A published community icon a diagram may draw by its `community/<slug>` slug. */
export interface CodeModeCommunityIcon {
	/** With the `community/` prefix. */
	readonly slug: string;
	readonly name: string;
	readonly recipe: IconRecipe;
}

/**
 * Where a host reads community icons from. Reading never fails a build or a
 * search: a host that cannot read its store returns none, and their slugs draw
 * nothing. Hidden icons are never returned.
 */
export interface CodeModeCommunityIcons {
	readonly load: (slugs: readonly string[]) => Effect.Effect<readonly CodeModeCommunityIcon[]>;
	/**
	 * A bounded set of icons whose name or slug contains the query, or a bare
	 * query; the caller ranks and truncates it.
	 */
	readonly search: (query: string) => Effect.Effect<readonly CodeModeCommunityIcon[]>;
}

/** The most community icons, and the most drawn icons, one request resolves. */
const MAX_REQUEST_ICONS = 24;

/** A drawn icon a request carries: the recipe and the name it draws under. */
export interface CodeModeDrawnIcon {
	readonly slug: string;
	readonly name: string;
	readonly recipe: IconRecipe;
}

const DRAWN_ICON_NAME = "Drawn icon";

/**
 * Every drawn icon a request carries, wherever it sits: any object whose
 * `recipe` checks, keyed by the slug the recipe draws under. A diagram's own
 * `drawn/…` assets count too, so a scene keeps its drawn icons through edits.
 */
export function drawnIconsIn(value: unknown): Map<string, CodeModeDrawnIcon> {
	const found = new Map<string, CodeModeDrawnIcon>();
	const visit = (entry: unknown, depth: number) => {
		if (found.size >= MAX_REQUEST_ICONS || depth > 12 || entry === null) return;
		if (Array.isArray(entry)) {
			for (const item of entry) visit(item, depth + 1);
			return;
		}
		if (typeof entry !== "object") return;
		const record = entry as Record<string, unknown>;
		const recipe = record["recipe"];
		if (recipe !== undefined) {
			if (isIconRecipe(recipe)) {
				const slug = drawnIconSlug(recipe);
				const name = typeof record["name"] === "string" ? cleanToolString(record["name"]) : "";
				if (!found.has(slug)) found.set(slug, { slug, name: name || DRAWN_ICON_NAME, recipe });
			}
			return;
		}
		for (const item of Object.values(record)) visit(item, depth + 1);
	};
	visit(value, 0);
	return found;
}

/** An authored icon: a slug or product name, or a drawn icon's name and recipe. */
export type CodeModeIconRef =
	| string
	| { readonly slug?: string; readonly name?: string; readonly recipe?: unknown };

/**
 * The slug an authored icon draws under: its own, normalized, or its recipe's
 * drawn slug; or why it draws nothing (a failed drawIcon result has no recipe).
 */
export function iconRefSlug(
	ref: CodeModeIconRef,
): { readonly slug: string } | { readonly problem: string } {
	if (typeof ref === "string") return { slug: normalizeIconSlug(ref) };
	if (ref.recipe !== undefined) {
		const [problem] = iconRecipeIssues(ref.recipe);
		return problem ? { problem } : { slug: drawnIconSlug(ref.recipe as IconRecipe) };
	}
	if (ref.slug !== undefined) return { slug: normalizeIconSlug(ref.slug) };
	return { problem: "it has neither a slug nor a recipe." };
}

/** The issue for an authored icon that names no slug and carries no drawable recipe. */
export function undrawableIconIssue(input: {
	readonly owner: string;
	readonly id: string;
	readonly path: string;
	readonly problem: string;
}): CodeModeIssue {
	return {
		code: "icon_dropped",
		severity: "warning",
		stage: "input",
		ref: { kind: "node", id: input.id, path: input.path },
		message: `The icon on ${input.owner} "${input.id}" cannot be drawn: ${input.problem} The ${input.owner} renders without it.`,
		hint: "Pass a slug from sketchi.searchIcons, or the result of a sketchi.drawIcon call that succeeded.",
	};
}

/** What a host without a catalog draws from: only drawn icons. */
const EMPTY_CATALOG: CodeModeIconCatalog = {
	get: () => undefined,
	wordmark: () => undefined,
	search: () => [],
	isStrayVendorLogo: () => false,
	logoNamedByLabel: () => undefined,
	labelLogos: () => ({ named: [], possible: [] }),
	loadSvg: (icon) =>
		Effect.fail(
			CodeModeIconLoadError.make({
				cause: undefined,
				message: "This host has no icon catalog.",
				slug: icon.slug,
			}),
		),
	recipe: () => undefined,
	slugLookup: "a host with an icon catalog",
};

/** The catalog with a request's drawn icons added under their drawn slugs. */
export function withDrawnIcons(
	catalog: CodeModeIconCatalog | undefined,
	drawn: ReadonlyMap<string, CodeModeDrawnIcon>,
): CodeModeIconCatalog | undefined {
	if (drawn.size === 0) return catalog;
	const base = catalog ?? EMPTY_CATALOG;
	const drawnIcon = (slug: string) => {
		const icon = drawn.get(slug);
		return icon ? { collection: DRAWN_ICON_COLLECTION, name: icon.name, slug } : undefined;
	};
	return {
		...base,
		get: (slug) => (isDrawnIconSlug(slug) ? drawnIcon(slug) : base.get(slug)),
		wordmark: (slug) => (isDrawnIconSlug(slug) ? undefined : base.wordmark(slug)),
		recipe: (slug) => (isDrawnIconSlug(slug) ? drawn.get(slug)?.recipe : base.recipe(slug)),
	};
}

/**
 * Every community slug a request names, wherever it sits: a node's `icon`
 * string, an `icon.slug`, a canvas element. Catalog slugs and other strings
 * are left alone, and a request naming none costs no lookup.
 */
export function communityIconSlugsIn(value: unknown): string[] {
	const found = new Set<string>();
	const visit = (entry: unknown, depth: number) => {
		if (found.size >= MAX_REQUEST_ICONS || depth > 12) return;
		if (typeof entry === "string") {
			if (entry.length > 100) return;
			const slug = normalizeIconSlug(entry);
			if (isCommunityIconSlug(slug)) found.add(slug);
			return;
		}
		if (Array.isArray(entry)) {
			for (const item of entry) visit(item, depth + 1);
			return;
		}
		if (entry !== null && typeof entry === "object") {
			for (const item of Object.values(entry)) visit(item, depth + 1);
		}
	};
	visit(value, 0);
	return [...found];
}

/**
 * The catalog with community icons added under their `community/` slugs.
 * They resolve by exact slug and draw by recipe; search, label matching and
 * vendor checks see only the catalog, and a catalog slug always wins.
 */
export function withCommunityIcons(
	catalog: CodeModeIconCatalog,
	icons: readonly CodeModeCommunityIcon[],
): CodeModeIconCatalog {
	const community = new Map(
		icons
			.filter((icon) => isCommunityIconSlug(icon.slug) && isIconRecipe(icon.recipe))
			.map((icon) => [icon.slug, icon] as const),
	);
	if (community.size === 0) return catalog;
	return {
		...catalog,
		get: (slug) => {
			const known = catalog.get(slug);
			if (known) return known;
			const icon = community.get(slug);
			return icon ? { collection: COMMUNITY_ICON_COLLECTION, name: icon.name, slug } : undefined;
		},
		recipe: (slug) => (catalog.get(slug) ? catalog.recipe(slug) : community.get(slug)?.recipe),
	};
}

/**
 * The catalog a request builds with: the host's, plus the community icons the
 * request names, read once per build, and the drawn icons it carries.
 */
export const catalogForRequest = Effect.fn("codeMode.icons.community")(function* (
	catalog: CodeModeIconCatalog | undefined,
	communityIcons: CodeModeCommunityIcons | undefined,
	request: unknown,
) {
	const drawn = drawnIconsIn(request);
	if (drawn.size > 0) yield* Effect.annotateCurrentSpan("sketchi.icons.drawn", drawn.size);
	if (!catalog || !communityIcons) return withDrawnIcons(catalog, drawn);
	const slugs = communityIconSlugsIn(request).filter((slug) => !catalog.get(slug));
	if (slugs.length === 0) return withDrawnIcons(catalog, drawn);
	yield* Effect.annotateCurrentSpan("sketchi.icons.community_requested", slugs.length);
	const icons = yield* communityIcons.load(slugs);
	yield* Effect.annotateCurrentSpan("sketchi.icons.community_found", icons.length);
	return withDrawnIcons(withCommunityIcons(catalog, icons), drawn);
});

const WORDMARK_QUERY = /\bwordmarks?\b/iu;

export function makeCodeModeIconCatalog(options: {
	readonly icons: readonly SketchiIcon[];
	/**
	 * Generic concepts (a database, a queue, a user) that search returns and a
	 * slug attaches; only those with a drawable recipe are offered.
	 */
	readonly concepts?: readonly ConceptIcon[];
	readonly loadSvg: (icon: CodeModeCatalogIcon) => Effect.Effect<string, CodeModeIconLoadError>;
	/** Hand-drawn recipes keyed by slug; undrawable ones are ignored. */
	readonly recipes?: Readonly<Record<string, unknown>>;
	readonly slugLookup: string;
	/** Whether loadSvg serves wordmarks too, which standalone icons may draw. */
	readonly wordmarks?: boolean;
}): CodeModeIconCatalog {
	const eligible = options.icons.filter(isNodeLogoEligible);
	const wordmarkIcons = options.wordmarks ? options.icons.filter(isStandaloneWordmark) : [];
	const wordmarks = new Map(wordmarkIcons.map((icon) => [icon.slug, catalogIcon(icon)] as const));
	const icons = new Map(eligible.map((icon) => [icon.slug, icon]));
	const recipeFor = (slug: string) => {
		const recipe = Object.hasOwn(options.recipes ?? {}, slug) ? options.recipes?.[slug] : undefined;
		return isIconRecipe(recipe) ? recipe : undefined;
	};
	// A concept needs its recipe and a slug no mark uses.
	const concepts = (options.concepts ?? [])
		.filter((concept) => !icons.has(concept.slug) && recipeFor(concept.slug))
		.map(conceptSearchIcon);
	const searchable = [...eligible, ...concepts];
	const bySlug = new Map(searchable.map((icon) => [icon.slug, catalogIcon(icon)]));
	const recipes = new Map(
		searchable.flatMap((icon) => {
			const recipe = recipeFor(icon.slug);
			return recipe ? [[icon.slug, recipe] as const] : [];
		}),
	);
	return {
		get: (slug) => bySlug.get(slug),
		wordmark: (slug) => wordmarks.get(slug),
		recipe: (slug) => recipes.get(slug),
		isStrayVendorLogo: (slug, label) => {
			const icon = icons.get(slug);
			return icon !== undefined && isStrayVendorLogo(icon, label);
		},
		logoNamedByLabel: (label) => {
			const icon = logoNamedByLabel(label, eligible);
			return icon ? bySlug.get(icon.slug) : undefined;
		},
		labelLogos: (label) => {
			const found = labelLogos(label, eligible);
			const marks = (icons: readonly SketchiIcon[]) =>
				icons.flatMap((icon) => {
					const mark = bySlug.get(icon.slug);
					return mark ? [mark] : [];
				});
			return { named: marks(found.named), possible: marks(found.possible) };
		},
		// Wordmarks answer only a query that asks for one ("Vercel wordmark").
		search: (query, limit) =>
			searchIcons(WORDMARK_QUERY.test(query) ? wordmarkIcons : searchable, {
				limit,
				query,
			}).map(({ icon }) => ({
				...catalogIcon(icon),
				match: iconMatch(icon, query),
			})),
		loadSvg: options.loadSvg,
		slugLookup: options.slugLookup,
	};
}

const SUGGESTION_LIMIT = 3;
const ICON_LOAD_CONCURRENCY = 8;

/** Agents may vary case or spacing; catalog slugs are lowercase. */
export function normalizeIconSlug(value: string): string {
	return cleanToolString(value).toLowerCase();
}

function iconSuggestions(
	catalog: CodeModeIconCatalog,
	slug: string,
): readonly CodeModeCatalogIcon[] {
	const words = slug.split(/[-_\s]+/u).filter(Boolean);
	const seen = new Set<string>();
	const suggestions: CodeModeCatalogIcon[] = [];
	// The whole phrase ranks first; single words rescue slugs with extra words.
	for (const query of [words.join(" "), ...words]) {
		if (!query) continue;
		for (const icon of catalog.search(query, SUGGESTION_LIMIT)) {
			if (seen.has(icon.slug)) continue;
			seen.add(icon.slug);
			suggestions.push(icon);
		}
		if (suggestions.length >= SUGGESTION_LIMIT) break;
	}
	return suggestions.slice(0, SUGGESTION_LIMIT);
}

function suggestionHint(catalog: CodeModeIconCatalog, slug: string): string {
	const suggestions = iconSuggestions(catalog, slug);
	return suggestions.length > 0
		? `Use an exact slug, for example ${suggestions
				.map((icon) => `"${icon.slug}" (${icon.name})`)
				.join(", ")}, or look one up with ${catalog.slugLookup}.`
		: `Look up an exact slug with ${catalog.slugLookup}, or omit icon.`;
}

function unknownIconIssue(input: {
	readonly catalog: CodeModeIconCatalog | undefined;
	readonly message: string;
	readonly ref: CodeModeIssue["ref"];
	readonly slug: string;
}): CodeModeIssue {
	return {
		code: "unknown_icon",
		severity: "warning",
		stage: "input",
		...(input.ref ? { ref: input.ref } : {}),
		message: input.message,
		hint: input.catalog
			? suggestionHint(input.catalog, input.slug)
			: "This Sketchi runtime has no icon catalog; omit icon or retry on a host with logos.",
	};
}

/**
 * Keep only icons whose slug names an eligible catalog mark, and vendor marks
 * only on labels naming their vendor. Unknown slugs are dropped with an
 * unknown_icon warning and stray vendor marks with icon_dropped, so the
 * diagram still builds. With fillNamedLogos, once the diagram draws a logo,
 * each node given none gets the one its label unmistakably names ("Ship to
 * Cloudflare Workers" draws cloudflare), reported as an icon_filled note:
 * models often leave one named product bare among logos, and a retry to add
 * it costs a turn.
 */
export function resolveNodeIcons<
	Node extends {
		readonly id: string;
		readonly icon?: Exclude<CodeModeIconRef, string>;
		readonly label: string;
	},
>(
	nodes: readonly Node[],
	catalog: CodeModeIconCatalog | undefined,
	/** Sequence diagrams draw logos on participants rather than nodes. */
	owner: { readonly noun: string; readonly path: string } = { noun: "node", path: "nodes" },
	policy: { readonly fillNamedLogos?: boolean } = {},
): { readonly issues: CodeModeIssue[]; readonly nodes: Node[] } {
	const issues: CodeModeIssue[] = [];
	const resolved = nodes.map((node) => {
		if (!node.icon) return node;
		const found = iconRefSlug(node.icon);
		if ("problem" in found) {
			issues.push(
				undrawableIconIssue({
					owner: owner.noun,
					id: node.id,
					path: `${owner.path}.icon`,
					problem: found.problem,
				}),
			);
			const { icon: _icon, ...withoutIcon } = node;
			return withoutIcon as Node;
		}
		const { slug } = found;
		const ref = { kind: "node" as const, id: node.id, path: `${owner.path}.icon.slug` };
		const icon = isDiagramIconSlug(slug) ? catalog?.get(slug) : undefined;
		if (icon && !catalog?.isStrayVendorLogo(slug, node.label)) {
			return { ...node, icon: { slug } };
		}
		issues.push(
			icon
				? {
						code: "icon_dropped",
						severity: "warning",
						stage: "input",
						ref,
						message: `Icon "${slug}" on ${owner.noun} "${node.id}" is a vendor logo, but the label "${node.label}" does not name ${icon.name}; the ${owner.noun} renders without a logo.`,
						hint: `Put a vendor's logo only on a ${owner.noun} whose label names that vendor ("Cloudflare Workers" takes cloudflare); other ${owner.noun}s take their product's own logo or none.`,
					}
				: unknownIconIssue({
						catalog,
						message: `Icon "${node.icon.slug ?? slug}" on ${owner.noun} "${node.id}" is not a Sketchi node logo; the ${owner.noun} renders without a logo.`,
						ref,
						slug,
					}),
		);
		const { icon: _icon, ...withoutIcon } = node;
		return withoutIcon as Node;
	});
	if (!policy.fillNamedLogos || !catalog || !resolved.some((node) => node.icon)) {
		return { issues, nodes: resolved };
	}
	const filled = resolved.map((node, index) => {
		// A node the model gave a logo keeps its choice, even a dropped one.
		if (nodes[index]?.icon) return node;
		const icon = catalog.logoNamedByLabel(node.label);
		if (!icon) return node;
		issues.push({
			code: "icon_filled",
			severity: "info",
			stage: "input",
			ref: { kind: "node", id: node.id, path: `${owner.path}.icon.slug` },
			message: `${owner.noun[0]?.toUpperCase()}${owner.noun.slice(1)} "${node.id}" draws the "${icon.slug}" logo because its label "${node.label}" names ${icon.name}.`,
			hint: "No action needed.",
		});
		return { ...node, icon: { slug: icon.slug } };
	});
	return { issues, nodes: filled };
}

/**
 * The logos a flowchart document's nodes draw. A node's `icon` names a product or a
 * catalog slug and resolves on the server, so no lookup round trip is needed; null
 * draws none. With `logos` set, every other node whose label unmistakably names a
 * product draws its logo, reported as icon_filled. A vendor's mark stays only on a
 * label that names the vendor. Concept marks are never filled from labels.
 */
export function resolveFlowchartLogos(
	document: {
		readonly logos?: boolean | "exact";
		readonly nodes: Readonly<
			Record<string, string | { readonly label: string; readonly icon?: CodeModeIconRef | null }>
		>;
	},
	catalog: CodeModeIconCatalog | undefined,
): { readonly issues: CodeModeIssue[]; readonly icons: ReadonlyMap<string, string> } {
	const icons = new Map<string, string>();
	const issues: CodeModeIssue[] = [];
	for (const [id, node] of Object.entries(document.nodes)) {
		const label = typeof node === "string" ? node : node.label;
		const requested = typeof node === "string" ? undefined : node.icon;
		if (requested === null) continue;
		const ref = { kind: "node" as const, id, path: `nodes.${id}.icon` };
		if (requested !== undefined && typeof requested !== "string") {
			const found = iconRefSlug(requested);
			if ("problem" in found) {
				issues.push(
					undrawableIconIssue({
						owner: "node",
						id,
						path: `nodes.${id}.icon`,
						problem: found.problem,
					}),
				);
			} else if (catalog?.get(found.slug)) {
				icons.set(id, found.slug);
			} else {
				issues.push(
					unknownIconIssue({
						catalog,
						message: `Icon "${found.slug}" on node "${id}" names no Sketchi logo; the node renders without one.`,
						ref,
						slug: found.slug,
					}),
				);
			}
			continue;
		}
		if (requested !== undefined) {
			const slug = normalizeIconSlug(requested);
			// A community or drawn slug names one drawing; it never falls back to a catalog mark.
			const icon =
				isCommunityIconSlug(slug) || isDrawnIconSlug(slug)
					? catalog?.get(slug)
					: ((isDiagramIconSlug(slug) ? catalog?.get(slug) : undefined) ??
						catalog?.labelLogos(requested).named[0] ??
						catalog?.labelLogos(requested).possible[0] ??
						catalog?.search(requested, 1).find((hit) => hit.match === "exact"));
			if (!icon) {
				issues.push(
					unknownIconIssue({
						catalog,
						message: `Icon "${requested}" on node "${id}" names no Sketchi logo; the node renders without one.`,
						ref,
						slug,
					}),
				);
				continue;
			}
			if (catalog?.isStrayVendorLogo(icon.slug, label)) {
				issues.push({
					code: "icon_dropped",
					severity: "warning",
					stage: "input",
					ref,
					message: `Icon "${icon.slug}" on node "${id}" is a vendor logo, but the label "${label}" does not name ${icon.name}; the node renders without a logo.`,
					hint: `Put a vendor's logo only on a node whose label names that vendor ("Cloudflare Workers" takes cloudflare).`,
				});
				continue;
			}
			icons.set(id, icon.slug);
			continue;
		}
		if (!document.logos || !catalog) continue;
		// A node draws one logo: the first product its label names.
		const found = catalog.labelLogos(label);
		const [named, ...others] = found.named;
		const [possible] = found.possible;
		if (!named && possible) {
			issues.push({
				code: "icon_possible",
				severity: "info",
				stage: "input",
				ref,
				message: `Node "${id}" draws no logo: its label "${label}" starts with "${label.trim().split(/\s+/u)[0]}", which usually names a step, not ${possible.name}.`,
				hint: `If it means ${possible.name}, set icon: "${possible.name}".`,
			});
			continue;
		}
		if (!named) continue;
		icons.set(id, named.slug);
		issues.push({
			code: "icon_filled",
			severity: "info",
			stage: "input",
			ref,
			message:
				others.length === 0
					? `Node "${id}" draws the "${named.slug}" logo because its label "${label}" names ${named.name}.`
					: `Node "${id}" draws the "${named.slug}" logo, the first of the products its label "${label}" names (${[named, ...others].map((icon) => icon.name).join(", ")}).`,
			hint:
				others.length === 0
					? "No action needed."
					: `Set icon to another of them, such as "${others[0]?.name}", to draw that one instead.`,
		});
	}
	return { issues, icons };
}

/**
 * With fillNamedLogos, once a flowchart's nodes draw a logo, each group whose
 * label unmistakably names one ("Vercel") draws it before that label, reported
 * as an icon_filled note, on the same terms as resolveNodeIcons fills a node.
 * Groups take no authored logo, so this is the only way one gets a logo. A
 * group skips a logo a node inside it already draws, or a group around it:
 * the group's header would only repeat it. Only groups that hold nodes draw.
 */
export function fillGroupLogos(
	groups:
		| readonly { readonly id: string; readonly label: string; readonly parent?: string }[]
		| undefined,
	/** Nodes as resolveNodeIcons left them. */
	nodes: readonly { readonly group?: string; readonly icon?: { readonly slug: string } }[],
	catalog: CodeModeIconCatalog | undefined,
	policy: { readonly fillNamedLogos?: boolean } = {},
): { readonly issues: CodeModeIssue[]; readonly logos: ReadonlyMap<string, string> } {
	const logos = new Map<string, string>();
	const issues: CodeModeIssue[] = [];
	if (!groups?.length || !policy.fillNamedLogos || !catalog || !nodes.some((node) => node.icon)) {
		return { issues, logos };
	}
	const parentOf = new Map(
		groups.flatMap((group) => (group.parent === undefined ? [] : [[group.id, group.parent]])),
	);
	// A group and every group around it, innermost first.
	const chain = (id: string | undefined) => {
		const ids: string[] = [];
		for (let group = id; group !== undefined && !ids.includes(group); group = parentOf.get(group))
			ids.push(group);
		return ids;
	};
	// The logos the nodes in each group draw, nested groups' nodes included.
	const inside = new Map<string, Set<string>>();
	for (const node of nodes) {
		for (const id of chain(node.group)) {
			const slugs = inside.get(id) ?? new Set<string>();
			if (node.icon) slugs.add(node.icon.slug);
			inside.set(id, slugs);
		}
	}
	// Outermost first, so a group around another keeps the logo they share.
	const depth = (id: string) => chain(id).length;
	for (const group of [...groups].sort((left, right) => depth(left.id) - depth(right.id))) {
		const held = inside.get(group.id);
		if (!held) continue;
		const icon = catalog.logoNamedByLabel(group.label);
		if (!icon || held.has(icon.slug)) continue;
		if (chain(group.parent).some((id) => logos.get(id) === icon.slug)) continue;
		logos.set(group.id, icon.slug);
		issues.push({
			code: "icon_filled",
			severity: "info",
			stage: "input",
			ref: { kind: "group", id: group.id },
			message: `Group "${group.id}" draws the "${icon.slug}" logo because its label "${group.label}" names ${icon.name}.`,
			hint: "No action needed.",
		});
	}
	return { issues, logos };
}

function droppedIconIssue(input: {
	readonly catalog: CodeModeIconCatalog | undefined;
	readonly dropped: DroppedCanvasIcon;
	readonly element: CanvasSpec["elements"][number] | undefined;
	readonly known: boolean;
}): CodeModeIssue {
	const { dropped, element } = input;
	const standalone = element?.type === "icon";
	const ref = {
		kind: "element" as const,
		id: dropped.elementId,
		path: standalone
			? `elements[${dropped.index}].slug`
			: `elements[${dropped.index}].icon${dropped.reason === "unavailable" ? ".slug" : ""}`,
	};
	if (standalone) {
		const message = `Icon element "${dropped.elementId}" (${dropped.slug}) was removed:`;
		return dropped.reason === "unavailable" && !input.known
			? unknownIconIssue({
					catalog: input.catalog,
					message: `${message} the slug names no Sketchi icon.`,
					ref,
					slug: dropped.slug,
				})
			: {
					code: "icon_dropped",
					severity: "warning",
					stage: "input",
					ref,
					message: `${message} ${dropped.reason === "budget" ? "the diagram's icon budget is spent." : "its mark could not be loaded."}`,
					hint:
						dropped.reason === "budget"
							? "Use fewer distinct icons in one diagram."
							: "Retry the request; if the icon stays unavailable, omit it.",
				};
	}
	const owner =
		element?.type === "frame" || (element?.type === "node" && element.rendererRole === "zone")
			? "group"
			: "node";
	const subject = `Icon "${dropped.slug}" on ${owner} "${dropped.elementId}"`;
	if (dropped.reason === "unavailable" && !input.known) {
		return unknownIconIssue({
			catalog: input.catalog,
			message: `${subject} is not a Sketchi node logo; the ${owner} renders without a logo.`,
			ref,
			slug: dropped.slug,
		});
	}
	const band = input.element?.type === "node" ? canvasNodeIconBand(input.element.icon) : 0;
	const details = {
		budget: {
			message: `${subject} exceeds the per-diagram logo budget; the ${owner} renders without a logo.`,
			hint: "Use fewer distinct logos in one diagram.",
		},
		lifeline: {
			message: `Sequence lifeline or activation "${dropped.elementId}" cannot carry a logo; the logo was dropped.`,
			hint: "Put logos on nodes or sequence participants, not on lifelines.",
		},
		no_room: {
			message: `${subject} does not fit above its label; the node renders without a logo.`,
			hint: `Make node "${dropped.elementId}" about ${band}px taller or shorten its label to keep the logo.`,
		},
		unavailable: {
			message: `${subject} could not be loaded; the ${owner} renders without a logo.`,
			hint: "Retry the request; if the logo stays unavailable, omit icon.",
		},
	}[dropped.reason];
	return {
		code: "icon_dropped",
		severity: "warning",
		stage: "input",
		ref,
		message: details.message,
		hint: details.hint,
	};
}

/**
 * Embed every node icon's catalog forms in a scene: its hand-drawn recipe,
 * and its normalized SVG only where the scene draws the exact mark (an icon
 * asking for it, every icon with `exactIcons`, or a slug with no recipe).
 * Authored assets are always replaced, so output depends only on slugs.
 * Unknown slugs are dropped with unknown_icon warnings; icons that fail to
 * load, sit on a lifeline, leave no room for their label, or exceed the
 * budget are dropped with icon_dropped warnings. An icon never fails the build.
 */
export const embedSceneIcons = Effect.fn("codeMode.icons.embedScene")(function* (
	scene: CanvasSpec,
	catalog: CodeModeIconCatalog | undefined,
	options: { readonly exactIcons?: boolean } = {},
) {
	const elements = scene.elements.map((element) => {
		if (element.type === "icon") return { ...element, slug: normalizeIconSlug(element.slug) };
		return (element.type === "node" || element.type === "frame") && element.icon
			? {
					...element,
					icon: {
						...element.icon,
						slug: normalizeIconSlug(element.icon.slug),
					},
				}
			: element;
	});
	const icons = elements.flatMap((element) => {
		const icon = canvasElementIcon(element);
		return icon ? [{ ...icon, standalone: element.type === "icon" }] : [];
	});
	// A standalone icon may draw a wordmark; a node's logo may not.
	const iconFor = (slug: string, standalone: boolean) => {
		if (!isDiagramIconSlug(slug)) return undefined;
		return catalog?.get(slug) ?? (standalone ? catalog?.wordmark(slug) : undefined);
	};
	const known = new Map(
		icons.flatMap(({ slug, standalone }) => {
			const icon = iconFor(slug, standalone);
			return icon ? [[slug, icon] as const] : [];
		}),
	);
	const recipes = new Map(
		[...known.keys()].flatMap((slug) => {
			const recipe = catalog?.recipe(slug);
			return recipe ? [[slug, recipe] as const] : [];
		}),
	);
	// A slug's SVG is read only when some icon draws the exact mark; a concept has none.
	const exactSlugs = new Set(
		icons
			.filter(({ exact, slug }) => options.exactIcons || exact || !recipes.has(slug))
			.map(({ slug }) => slug)
			.filter((slug) => {
				const icon = known.get(slug);
				return icon !== undefined && !isRecipeOnlyIcon(icon);
			}),
	);
	const loaded = yield* Effect.forEach(
		[...known.values()].filter((icon) => exactSlugs.has(icon.slug)),
		(icon) =>
			catalog
				? catalog.loadSvg(icon).pipe(
						// Malformed SVG is an unusable asset, like a missing one.
						Effect.flatMap((svg) =>
							Effect.try({
								try: () => normalizeNodeLogoSvg(svg),
								catch: (cause) =>
									CodeModeIconLoadError.make({
										cause,
										message: `Node logo ${icon.slug} has unusable SVG.`,
										slug: icon.slug,
									}),
							}),
						),
						Effect.map((svg) => [icon.slug, svg] as const),
						// Only asset failures drop the icon; defects and interruption propagate.
						Effect.catchTag("CodeModeIconLoadError", (error) =>
							Effect.logWarning("Code Mode icon asset unavailable", {
								error_tag: error._tag,
								slug: error.slug,
							}).pipe(Effect.as(undefined)),
						),
					)
				: Effect.succeed(undefined),
		{ concurrency: ICON_LOAD_CONCURRENCY },
	);
	const svgs = new Map(loaded.flatMap((entry) => (entry ? [entry] : [])));
	const assetFor = (slug: string, standalone: boolean): CanvasIconAsset | undefined => {
		const icon = iconFor(slug, standalone);
		const recipe = recipes.get(slug);
		const svg = svgs.get(slug);
		if (!icon || (!recipe && svg === undefined)) return undefined;
		return {
			name: icon.name,
			...(recipe ? { recipe } : {}),
			...(svg === undefined ? {} : { svg }),
		};
	};
	const embedding = embedCanvasIcons({ ...scene, elements }, assetFor, options);
	const issues = embedding.dropped.map((dropped) =>
		droppedIconIssue({
			catalog,
			dropped,
			element: elements[dropped.index],
			known: iconFor(dropped.slug, elements[dropped.index]?.type === "icon") !== undefined,
		}),
	);
	return { issues, scene: embedding.scene };
});
