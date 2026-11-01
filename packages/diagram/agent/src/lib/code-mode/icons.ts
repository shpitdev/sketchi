import {
	canvasNodeIconBand,
	embedCanvasIcons,
	isDiagramIconSlug,
	type CanvasIconAsset,
	type CanvasSpec,
	type DroppedCanvasIcon,
} from "@sketchi/diagram-core";
import {
	iconMatch,
	isNodeLogoEligible,
	isStrayVendorLogo,
	logoNamedByLabel,
	normalizeNodeLogoSvg,
	searchIcons,
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
	const icons = new Map(eligible.map((icon) => [icon.slug, icon]));
	const bySlug = new Map(eligible.map((icon) => [icon.slug, catalogIcon(icon)]));
	return {
		get: (slug) => bySlug.get(slug),
		isStrayVendorLogo: (slug, label) => {
			const icon = icons.get(slug);
			return icon !== undefined && isStrayVendorLogo(icon, label);
		},
		logoNamedByLabel: (label) => {
			const icon = logoNamedByLabel(label, eligible);
			return icon ? bySlug.get(icon.slug) : undefined;
		},
		search: (query, limit) =>
			searchIcons(eligible, { limit, query }).map(({ icon }) => ({
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
		readonly icon?: { readonly slug: string };
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
		const slug = normalizeIconSlug(node.icon.slug);
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
						message: `Icon "${node.icon.slug}" on ${owner.noun} "${node.id}" is not a Sketchi node logo; the ${owner.noun} renders without a logo.`,
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
	const { dropped } = input;
	const ref = {
		kind: "element" as const,
		id: dropped.elementId,
		path: `elements[${dropped.index}].icon${dropped.reason === "unavailable" ? ".slug" : ""}`,
	};
	const { element } = input;
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
		(element.type === "node" || element.type === "frame") && element.icon
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
				(element.type === "node" || element.type === "frame") && element.icon
					? [element.icon.slug]
					: [],
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
						Effect.map((svg): readonly [string, CanvasIconAsset] => [
							icon.slug,
							{ name: icon.name, svg },
						]),
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
