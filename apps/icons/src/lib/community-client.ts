import { isIconRecipe, type IconRecipe } from "@sketchi/diagram-core/icon-recipe";

/** A community icon as the gallery shows it; `slug` is `community/<slug>`. */
export interface CommunityIconEntry {
	readonly slug: string;
	readonly name: string;
	readonly recipe: IconRecipe;
	readonly createdAt: string;
	readonly url: string;
}

export interface CommunityPage {
	readonly icons: readonly CommunityIconEntry[];
	readonly nextCursor?: string;
}

function entry(value: unknown): CommunityIconEntry | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const { slug, name, recipe, createdAt, url } = record;
	if (
		typeof slug !== "string" ||
		typeof name !== "string" ||
		typeof createdAt !== "string" ||
		typeof url !== "string" ||
		!isIconRecipe(recipe)
	) {
		return undefined;
	}
	return { slug, name, recipe, createdAt, url };
}

export async function fetchCommunityPage(input: {
	readonly query: string;
	readonly cursor?: string;
	readonly signal?: AbortSignal;
}): Promise<CommunityPage> {
	const params = new URLSearchParams();
	if (input.query.trim()) params.set("q", input.query.trim());
	if (input.cursor) params.set("cursor", input.cursor);
	const response = await fetch(`/api/community${params.size ? `?${params}` : ""}`, {
		...(input.signal ? { signal: input.signal } : {}),
	});
	if (!response.ok) throw new Error(`Community icons returned HTTP ${response.status}.`);
	const payload = (await response.json()) as { results?: unknown; nextCursor?: unknown };
	const icons = Array.isArray(payload.results)
		? payload.results.flatMap((value) => {
				const icon = entry(value);
				return icon ? [icon] : [];
			})
		: [];
	return typeof payload.nextCursor === "string"
		? { icons, nextCursor: payload.nextCursor }
		: { icons };
}

/** The bare slug, for file names and element ids. */
export function bareSlug(slug: string): string {
	return slug.replace(/^community\//u, "");
}

/** A linked icon: found, or not published (never published, or hidden). */
export type LinkedCommunityIcon =
	| { readonly status: "found"; readonly icon: CommunityIconEntry }
	| { readonly status: "missing" };

/** One icon by slug; a 404 is a defined result, other failures throw. */
export async function fetchCommunityIcon(
	slug: string,
	signal?: AbortSignal,
): Promise<LinkedCommunityIcon> {
	const response = await fetch(`/api/community/${encodeURIComponent(bareSlug(slug))}`, {
		...(signal ? { signal } : {}),
	});
	if (response.status === 404) return { status: "missing" };
	if (!response.ok) throw new Error(`Community icon returned HTTP ${response.status}.`);
	const icon = entry(await response.json());
	return icon ? { status: "found", icon } : { status: "missing" };
}
