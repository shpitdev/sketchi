import { fnv1a32 } from "@sketchi/diagram-core";
import type { SketchiIcon } from "@sketchi/icon-catalog";

export interface CatalogMark {
	readonly slug: string;
	readonly name: string;
	readonly collection: string;
}

export interface SelectOptions {
	/** Draw exactly these slugs, in this order. */
	readonly slugs?: readonly string[];
	/** A spread across collections: this many marks, taken in turn from each. */
	readonly sample?: number;
}

/** Collections not drawn: `gcp-legacy` holds older copies of the current `gcp` product icons. */
export const SKIPPED_COLLECTIONS: ReadonlySet<string> = new Set(["gcp-legacy"]);

/** A stable order that does not follow names, so a sample is not all one letter. */
function shuffled(icons: readonly SketchiIcon[]): SketchiIcon[] {
	return [...icons].sort(
		(left, right) =>
			fnv1a32(left.slug, "seed") - fnv1a32(right.slug, "seed") ||
			left.slug.localeCompare(right.slug),
	);
}

/**
 * The catalog marks that have no hand-drawn recipe yet. `marks` is the
 * catalog's node logos, so wordmarks are already out: diagrams never embed
 * one in a node, and a recipe's text is at most a short word. Skipped
 * collections are left out unless a slug is named.
 */
export function marksToDraw(
	marks: readonly SketchiIcon[],
	drawn: ReadonlySet<string>,
	options: SelectOptions = {},
): CatalogMark[] {
	const pending = marks.filter(
		(icon) => !drawn.has(icon.slug) && !SKIPPED_COLLECTIONS.has(icon.collection),
	);
	const mark = (icon: SketchiIcon): CatalogMark => ({
		slug: icon.slug,
		name: icon.name,
		collection: icon.collection,
	});
	if (options.slugs) {
		const bySlug = new Map(marks.map((icon) => [icon.slug, icon]));
		return options.slugs.map((slug) => {
			const icon = bySlug.get(slug);
			if (!icon) throw new Error(`${slug} is not a catalog mark (wordmarks are not drawn).`);
			return mark(icon);
		});
	}
	if (options.sample === undefined) return pending.map(mark);
	const byCollection = new Map<string, SketchiIcon[]>();
	for (const icon of shuffled(pending)) {
		byCollection.set(icon.collection, [...(byCollection.get(icon.collection) ?? []), icon]);
	}
	const queues = [...byCollection.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, icons]) => icons);
	const sample: CatalogMark[] = [];
	for (let round = 0; sample.length < options.sample; round += 1) {
		const before = sample.length;
		for (const queue of queues) {
			const icon = queue[round];
			if (icon && sample.length < options.sample) sample.push(mark(icon));
		}
		if (sample.length === before) break;
	}
	return sample;
}
