import "@tanstack/react-start/server-only";

import {
	bareCommunitySlug,
	COMMUNITY_ICON_LIMITS,
	communityDiagramSlug,
	communityIconBaseSlug,
	communityIconStoreLayer,
	CommunityIconStore,
	type CommunityIcon,
	type CommunityEnv,
} from "@sketchi/community-icons";
import type { CodeModeCommunityIcons } from "@sketchi/diagrams/build/code-mode/icons";
import { Array, Effect, String } from "effect";

/**
 * Community icons read from the store the icons app publishes to. A store
 * that cannot be read draws no community icons; the build reports each slug
 * as unknown rather than failing.
 */
export function studioCommunityIcons(
	database: NonNullable<CommunityEnv["COMMUNITY_ICONS"]>,
): CodeModeCommunityIcons {
	const forDiagrams = <E extends { readonly _tag: string }>(
		read: Effect.Effect<readonly CommunityIcon[], E, CommunityIconStore>,
	) =>
		read.pipe(
			// @effect-diagnostics-next-line strictEffectProvide:off -- Studio community capability entry points own a request-bound native store; no binding or cache survives the invocation.
			Effect.provide(communityIconStoreLayer(database)),
			Effect.map((icons) =>
				Array.map(icons, (icon) => ({
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
	return {
		load: (slugs) =>
			forDiagrams(
				Effect.flatMap(CommunityIconStore, (store) =>
					store.getMany(Array.map(slugs, bareCommunitySlug)),
				),
			),
		// The icon named exactly by the query, then the newest page of partial matches:
		// the caller ranks them, so an exact match never falls behind newer partial ones.
		search: (query) =>
			forDiagrams(
				Effect.flatMap(CommunityIconStore, (store) =>
					Effect.all([
						store.getMany(String.trim(query) ? [communityIconBaseSlug(query)] : []),
						store.search({ query, limit: COMMUNITY_ICON_LIMITS.maxPageSize }),
					]),
				).pipe(
					Effect.map(([exact, page]) => [
						...exact,
						...Array.filter(
							page.icons,
							(icon) => !Array.some(exact, (hit) => hit.slug === icon.slug),
						),
					]),
				),
			),
	};
}
