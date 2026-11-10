import "@tanstack/react-start/server-only";

import {
	bareCommunitySlug,
	COMMUNITY_ICON_LIMITS,
	communityDiagramSlug,
	communityIconBaseSlug,
	makeCommunityIconStore,
	type CommunityIcon,
	type CommunityIconDatabase,
} from "@sketchi/community-icons";
import type { CodeModeCommunityIcons } from "@sketchi/diagram-agent";
import { Effect } from "effect";

const sources = new WeakMap<CommunityIconDatabase, CodeModeCommunityIcons>();

/**
 * Community icons read from the store the icons app publishes to. A store
 * that cannot be read draws no community icons; the build reports each slug
 * as unknown rather than failing.
 */
export function studioCommunityIcons(database: CommunityIconDatabase): CodeModeCommunityIcons {
	const cached = sources.get(database);
	if (cached) return cached;
	const store = makeCommunityIconStore(database);
	const forDiagrams = <E extends { readonly _tag: string }>(
		read: Effect.Effect<readonly CommunityIcon[], E>,
	) =>
		read.pipe(
			Effect.map((icons) =>
				icons.map((icon) => ({
					slug: communityDiagramSlug(icon.slug),
					name: icon.name,
					recipe: icon.recipe,
				})),
			),
			Effect.catch((error) =>
				Effect.logWarning("Community icons unavailable", { error_tag: error._tag }).pipe(
					Effect.as([]),
				),
			),
		);
	const source: CodeModeCommunityIcons = {
		load: (slugs) => forDiagrams(store.getMany(slugs.map(bareCommunitySlug))),
		// The icon named exactly by the query, then the newest page of partial matches:
		// the caller ranks them, so an exact match never falls behind newer partial ones.
		search: (query) =>
			forDiagrams(
				Effect.all([
					store.getMany(query.trim() ? [communityIconBaseSlug(query)] : []),
					store.search({ query, limit: COMMUNITY_ICON_LIMITS.maxPageSize }),
				]).pipe(
					Effect.map(([exact, page]) => [
						...exact,
						...page.icons.filter((icon) => !exact.some((hit) => hit.slug === icon.slug)),
					]),
				),
			),
	};
	sources.set(database, source);
	return source;
}
