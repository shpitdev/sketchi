import {
	canvasNodeIconBand,
	embedCanvasIcons,
	isDiagramIconSlug,
	type CanvasIconAsset,
	type CanvasSpec,
	type DroppedCanvasIcon,
} from "@sketchi/diagram-core";
import {
	isNodeLogoEligible,
	normalizeNodeLogoSvg,
	searchIcons,
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
	/** Ranked node-logo search, shared with icons.sketchi.app. */
	readonly search: (query: string, limit: number) => readonly CodeModeCatalogIcon[];
	/** Raw SVG source for an eligible mark. */
	readonly loadSvg: (icon: CodeModeCatalogIcon) => Effect.Effect<string, CodeModeIconLoadError>;
	/**
	 * Where this host's agents look up exact slugs, quoted in unknown_icon
	 * hints: `sketchi.searchIcons({ q })` in Code Mode, the catalog site offline.
	 */
	readonly slugLookup: string;
}

function catalogIcon(icon: SketchiIcon): CodeModeCatalogIcon {
	return { collection: icon.collection, name: icon.name, slug: icon.slug };
}

export function makeCodeModeIconCatalog(options: {
	readonly icons: readonly SketchiIcon[];
	readonly loadSvg: (icon: CodeModeCatalogIcon) => Effect.Effect<string, CodeModeIconLoadError>;
	readonly slugLookup: string;
}): CodeModeIconCatalog {
	const eligible = options.icons.filter(isNodeLogoEligible);
	const bySlug = new Map(eligible.map((icon) => [icon.slug, catalogIcon(icon)]));
	return {
		get: (slug) => bySlug.get(slug),
		search: (query, limit) =>
			searchIcons(eligible, { limit, query }).map(({ icon }) => catalogIcon(icon)),
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
 * Keep only icons whose slug names an eligible catalog mark. Anything else is
 * dropped with an unknown_icon warning so the diagram still builds.
 */
export function resolveNodeIcons<
	Node extends {
		readonly id: string;
		readonly icon?: { readonly slug: string };
	},
>(
	nodes: readonly Node[],
	catalog: CodeModeIconCatalog | undefined,
): { readonly issues: CodeModeIssue[]; readonly nodes: Node[] } {
	const issues: CodeModeIssue[] = [];
	const resolved = nodes.map((node) => {
		if (!node.icon) return node;
		const slug = normalizeIconSlug(node.icon.slug);
		if (isDiagramIconSlug(slug) && catalog?.get(slug)) {
			return { ...node, icon: { slug } };
		}
		issues.push(
			unknownIconIssue({
				catalog,
				message: `Icon "${node.icon.slug}" on node "${node.id}" is not a Sketchi node logo; the node renders without a logo.`,
				ref: { kind: "node", id: node.id, path: "nodes.icon.slug" },
				slug,
			}),
		);
		const { icon: _icon, ...withoutIcon } = node;
		return withoutIcon as Node;
	});
	return { issues, nodes: resolved };
}

function droppedIconIssue(input: {
	readonly catalog: CodeModeIconCatalog | undefined;
	readonly dropped: DroppedCanvasIcon;
	readonly element: CanvasSpec["elements"][number] | undefined;
	readonly known: boolean;
}): CodeModeIssue {
	const { dropped } = input;
	const ref = {
		kind: "element" as const,
		id: dropped.elementId,
		path: `elements[${dropped.index}].icon${dropped.reason === "unavailable" ? ".slug" : ""}`,
	};
	const subject = `Icon "${dropped.slug}" on node "${dropped.elementId}"`;
	if (dropped.reason === "unavailable" && !input.known) {
		return unknownIconIssue({
			catalog: input.catalog,
			message: `${subject} is not a Sketchi node logo; the node renders without a logo.`,
			ref,
			slug: dropped.slug,
		});
	}
	const band = input.element?.type === "node" ? canvasNodeIconBand(input.element.icon) : 0;
	const details = {
		budget: {
			message: `${subject} exceeds the per-diagram logo budget; the node renders without a logo.`,
			hint: "Use fewer distinct logos in one diagram.",
		},
		lifeline: {
			message: `Sequence lifeline "${dropped.elementId}" cannot carry a logo; the logo was dropped.`,
			hint: "Put logos on nodes, not on sequence lifelines.",
		},
		no_room: {
			message: `${subject} does not fit above its label; the node renders without a logo.`,
			hint: `Make node "${dropped.elementId}" about ${band}px taller or shorten its label to keep the logo.`,
		},
		unavailable: {
			message: `${subject} could not be loaded; the node renders without a logo.`,
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
 * Embed normalized catalog SVGs for every node icon in a scene. Authored assets
 * are always replaced, so output depends only on slugs. Unknown slugs are
 * dropped with unknown_icon warnings; icons that fail to load, sit on a
 * lifeline, leave no room for their label, or exceed the budget are dropped
 * with icon_dropped warnings. An icon never fails the build.
 */
export const embedSceneIcons = Effect.fn("codeMode.icons.embedScene")(function* (
	scene: CanvasSpec,
	catalog: CodeModeIconCatalog | undefined,
) {
	const elements = scene.elements.map((element) =>
		element.type === "node" && element.icon
			? {
					...element,
					icon: {
						...element.icon,
						slug: normalizeIconSlug(element.icon.slug),
					},
				}
			: element,
	);
	const slugs = [
		...new Set(
			elements.flatMap((element) =>
				element.type === "node" && element.icon ? [element.icon.slug] : [],
			),
		),
	];
	const known = new Map(
		slugs.flatMap((slug) => {
			const icon = isDiagramIconSlug(slug) ? catalog?.get(slug) : undefined;
			return icon ? [[slug, icon] as const] : [];
		}),
	);
	const loaded = yield* Effect.forEach(
		[...known.values()],
		(icon) =>
			catalog
				? catalog.loadSvg(icon).pipe(
						Effect.map((svg) => normalizeNodeLogoSvg(svg)),
						Effect.map((svg): readonly [string, CanvasIconAsset] => [
							icon.slug,
							{ name: icon.name, svg },
						]),
						Effect.catchCause((cause) =>
							Effect.logWarning("Code Mode icon asset unavailable", {
								slug: icon.slug,
								cause,
							}).pipe(Effect.as(undefined)),
						),
					)
				: Effect.succeed(undefined),
		{ concurrency: ICON_LOAD_CONCURRENCY },
	);
	const assets = new Map(loaded.flatMap((entry) => (entry ? [entry] : [])));
	const embedding = embedCanvasIcons({ ...scene, elements }, (slug) => assets.get(slug));
	const issues = embedding.dropped.map((dropped) =>
		droppedIconIssue({
			catalog,
			dropped,
			element: elements[dropped.index],
			known: known.has(dropped.slug),
		}),
	);
	return { issues, scene: embedding.scene };
});
