import { labelLogos, matchIconMentions } from "@sketchi/icon-catalog";

/** A logo a prompt names: the only slugs a generated node icon may use. */
export interface OfferedLogo {
	readonly aliases?: readonly string[];
	/**
	 * The text names this product by an everyday word it never uses otherwise, so every label
	 * with the word names it (see NamedLogo.alwaysNamed).
	 */
	readonly alwaysNamed?: true;
	/** The catalog collection, which marks cloud vendors (see isVendorLogo). */
	readonly collection?: string;
	readonly name: string;
	readonly slug: string;
}

interface PlaceableNode {
	readonly icon?: { readonly slug: string } | undefined;
	readonly id: string;
	readonly label: string;
}

/** Whether a label names a logo's technology, by a catalog mention or its name or alias as words. */
function labelNames(
	label: string,
	logo: Parameters<typeof matchIconMentions>[1][number] & { readonly aliases: readonly string[] },
): boolean {
	if (matchIconMentions(label, [logo]).length > 0) return true;
	const words = ` ${label.toLowerCase().replace(/[^\p{L}\p{N}.+#]+/gu, " ")} `;
	return [logo.name, ...logo.aliases].some((name) => words.includes(` ${name.toLowerCase()} `));
}

/**
 * Put each offered logo on the node whose label names that technology, and keep
 * a model-chosen logo only on a node whose own label names it, so a logo never
 * sits on a generic step ("Return answer") or stands in for a technology the
 * label leaves out ("Check cache" with Redis's logo). Small models often shift
 * logos by a node, while labels say exactly which step a technology belongs to.
 * A label names a product as a diagram's build reads it (see labelLogos): an
 * everyday-word name ("Go", "Linear", "Render") counts mid-label ("Track work in
 * Linear") or before a tech noun ("Go service"), and anywhere in the label when
 * the request only ever wrote it as the name ("Stripe charge" after "charges
 * cards through Stripe"). A step it starts ("Go live", "Render page") draws
 * nothing unless the model chose that logo. Deterministic for given nodes and logos.
 */
export function placeNodeLogos<Node extends PlaceableNode>(
	nodes: readonly Node[],
	logos: readonly OfferedLogo[],
	/** Sequence diagrams place logos on participants rather than nodes. */
	noun: "node" | "participant" = "node",
): { readonly diagnostics: string[]; readonly nodes: Node[] } {
	const terms = logos.map((logo) => ({
		aliases: logo.aliases ?? [],
		collection: logo.collection ?? "",
		keywords: [],
		name: logo.name,
		slug: logo.slug,
	}));
	const offered = new Map(terms.map((term) => [term.slug, term]));
	const alwaysNamed = new Set(logos.filter((logo) => logo.alwaysNamed).map((logo) => logo.slug));
	// A label that names two products draws the one it is, not the platform it runs on.
	const labelSlugs = nodes.map(
		(node) => labelLogos(node.label, terms, { alwaysNamed, offered: true }).named[0]?.slug,
	);
	const namedByLabels = new Set(labelSlugs.filter(Boolean));
	const diagnostics: string[] = [];
	const placed = nodes.map((node, index) => {
		const named = labelSlugs[index];
		const chosen = node.icon?.slug;
		const { icon: _icon, ...withoutIcon } = node;
		if (named) {
			if (chosen !== named) {
				diagnostics.push(
					`icon_placed: ${noun} "${node.id}" names ${named}, so it draws that logo${chosen ? ` instead of "${chosen}"` : ""}.`,
				);
			}
			return { ...withoutIcon, icon: { slug: named } } as Node;
		}
		if (!chosen) return node;
		const logo = offered.get(chosen);
		if (logo && labelNames(node.label, logo)) return node;
		diagnostics.push(
			!logo
				? `icon_not_in_prompt: ${noun} "${node.id}" icon "${chosen}" is not a logo the prompt names; the ${noun} renders without a logo.`
				: namedByLabels.has(chosen)
					? `icon_dropped: ${noun} "${node.id}" logo "${chosen}" belongs to the ${noun} whose label names it.`
					: `icon_dropped: ${noun} "${node.id}" logo "${chosen}" is not named by its label "${node.label}".`,
		);
		return withoutIcon as Node;
	});
	return { diagnostics, nodes: placed };
}
