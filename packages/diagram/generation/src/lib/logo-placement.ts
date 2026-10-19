import { isStrayVendorLogo, matchIconMentions } from "@sketchi/icon-catalog";

/** A logo a prompt names: the only slugs a generated node icon may use. */
export interface OfferedLogo {
	readonly aliases?: readonly string[];
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

/**
 * Put each offered logo on the node whose label unmistakably names that
 * technology, and keep a model-chosen logo only when no label names it and,
 * for a vendor's logo, when its own label names the vendor ("Cloudflare
 * Workers" keeps cloudflare, "Ingress controller" loses kubernetes); drop
 * everything else. Small models often shift logos by a node, while labels say
 * exactly which step a technology belongs to. Everyday-word names ("Go",
 * "Linear", "Render") never place a logo from a label, where Title Case makes
 * every word look like a name; for those only the model's choice counts.
 * Deterministic for given nodes and logos.
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
	const labelSlugs = nodes.map(
		(node) =>
			matchIconMentions(node.label, terms).find((mention) => mention.distinctive)?.icon.slug,
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
		const stray = logo !== undefined && isStrayVendorLogo(logo, node.label);
		if (logo && !namedByLabels.has(chosen) && !stray) return node;
		diagnostics.push(
			!logo
				? `icon_not_in_prompt: ${noun} "${node.id}" icon "${chosen}" is not a logo the prompt names; the ${noun} renders without a logo.`
				: namedByLabels.has(chosen)
					? `icon_dropped: ${noun} "${node.id}" logo "${chosen}" belongs to the ${noun} whose label names it.`
					: `icon_dropped: ${noun} "${node.id}" logo "${chosen}" is a vendor logo, but its label "${node.label}" does not name ${logo.name}.`,
		);
		return withoutIcon as Node;
	});
	return { diagnostics, nodes: placed };
}
