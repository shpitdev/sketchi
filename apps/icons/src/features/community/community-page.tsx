import { useAtom, useAtomValue, useAtomRefresh } from "@effect/atom-react";
import { Array, Option } from "effect";
import { AsyncResult } from "effect/reactivity";

import { communityPages, communitySearch, linkedCommunityIcon } from "../../lib/community-atoms";
import type { CommunityIconEntry } from "../../lib/community-client";
import { queryError, queryStatus } from "../../lib/query-atoms";
import { CommunityGallery } from "./community-gallery";

/** The Community view: newest first, searched on the server as the user types. */
export function CommunityPage({ slug }: { readonly slug?: string }) {
	const [query, setQuery] = useAtom(communitySearch);
	const [pages, loadMore] = useAtom(communityPages);
	const retry = useAtomRefresh(communityPages);
	const linked = useAtomValue(linkedCommunityIcon(slug));
	const retryLinked = useAtomRefresh(linkedCommunityIcon(slug));
	const data = Option.getOrUndefined(AsyncResult.value(pages));
	const detail = Option.getOrUndefined(AsyncResult.value(linked));
	const icons = Array.dedupeWith(
		Array.flatMap(data?.items ?? [], (page) => page.results),
		(a: CommunityIconEntry, b: CommunityIconEntry) => a.slug === b.slug,
	);
	const hasMore = Option.getOrUndefined(Array.last(data?.items ?? []))?.nextCursor !== undefined;

	if (slug !== undefined && AsyncResult.isInitial(linked)) {
		return (
			<CommunityGallery
				icons={[]}
				key="linked"
				onQueryChange={setQuery}
				query={query}
				status="loading"
			/>
		);
	}
	return (
		<CommunityGallery
			key={detail?.status === "found" ? detail.icon.slug : "gallery"}
			{...(detail?.status === "found" ? { initialIcon: detail.icon } : {})}
			{...(slug !== undefined && detail?.status === "missing"
				? { linked: { slug, status: "missing" as const } }
				: {})}
			{...(slug !== undefined && AsyncResult.isFailure(linked)
				? { linked: { slug, status: "error" as const }, onRetryLinked: retryLinked }
				: {})}
			{...(AsyncResult.isFailure(pages)
				? { errorMessage: queryError(pages, "Community icons could not be loaded.") }
				: {})}
			hasMore={hasMore}
			icons={icons}
			loadingMore={pages.waiting && data !== undefined}
			onLoadMore={loadMore}
			onQueryChange={setQuery}
			onRetry={retry}
			query={query}
			status={queryStatus(pages)}
		/>
	);
}
