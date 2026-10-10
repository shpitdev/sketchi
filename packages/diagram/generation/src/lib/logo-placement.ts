import { matchIconMentions } from "@sketchi/icon-catalog";

/** A logo a prompt names: the only slugs a generated node icon may use. */
export interface OfferedLogo {
  readonly aliases?: readonly string[];
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
 * technology, and keep a model-chosen logo only when no label names it; drop
 * everything else. Small models often shift logos by a node, while labels say
 * exactly which step a technology belongs to. Everyday-word names ("Go",
 * "Linear", "Render") never place a logo from a label, where Title Case makes
 * every word look like a name; for those only the model's choice counts.
 * Deterministic for given nodes and logos.
 */
export function placeNodeLogos<Node extends PlaceableNode>(
  nodes: readonly Node[],
  logos: readonly OfferedLogo[],
): { readonly diagnostics: string[]; readonly nodes: Node[] } {
  const terms = logos.map((logo) => ({
    aliases: logo.aliases ?? [],
    collection: "",
    keywords: [],
    name: logo.name,
    slug: logo.slug,
  }));
  const offered = new Set(logos.map((logo) => logo.slug));
  const labelSlugs = nodes.map(
    (node) =>
      matchIconMentions(node.label, terms).find(
        (mention) => mention.distinctive,
      )?.icon.slug,
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
          `icon_placed: node "${node.id}" names ${named}, so it draws that logo${chosen ? ` instead of "${chosen}"` : ""}.`,
        );
      }
      return { ...withoutIcon, icon: { slug: named } } as Node;
    }
    if (!chosen) return node;
    if (offered.has(chosen) && !namedByLabels.has(chosen)) return node;
    diagnostics.push(
      offered.has(chosen)
        ? `icon_dropped: node "${node.id}" logo "${chosen}" belongs to the node whose label names it.`
        : `icon_not_in_prompt: node "${node.id}" icon "${chosen}" is not a logo the prompt names; the node renders without a logo.`,
    );
    return withoutIcon as Node;
  });
  return { diagnostics, nodes: placed };
}
