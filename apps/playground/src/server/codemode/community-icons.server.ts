import "@tanstack/react-start/server-only";

import {
	bareCommunitySlug,
	communityDiagramSlug,
	makeCommunityIconStore,
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
	const source: CodeModeCommunityIcons = {
		load: (slugs) =>
			store.getMany(slugs.map(bareCommunitySlug)).pipe(
				Effect.map((icons) =>
					icons.map((icon) => ({
						slug: communityDiagramSlug(icon.slug),
						name: icon.name,
						recipe: icon.recipe,
					})),
				),
				Effect.catchTag("CommunityIconStorageError", (error) =>
					Effect.logWarning("Community icons unavailable", { error_tag: error._tag }).pipe(
						Effect.as([]),
					),
				),
			),
	};
	sources.set(database, source);
	return source;
}
