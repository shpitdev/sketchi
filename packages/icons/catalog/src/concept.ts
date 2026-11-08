/**
 * Generic concepts diagrams draw as hand-drawn icons: a database, a queue, a
 * user. They are not brand logos and have no exact mark: agents find them
 * with icon search and attach them by slug, and no label fills one in.
 */
export const CONCEPT_COLLECTION = "concepts";

export interface ConceptIcon {
	readonly slug: string;
	readonly name: string;
	/** Other names agents search by. */
	readonly aliases: readonly string[];
	/** The Lucide icon the catalog build transcribes; omitted when recipes/concepts/<slug>.json draws it. */
	readonly lucide?: string;
}
