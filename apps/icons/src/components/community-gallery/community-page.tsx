import { keepPreviousData, QueryClient, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";

import {
	fetchCommunityIcon,
	fetchCommunityPage,
	type CommunityPage as CommunityIconPage,
} from "../../lib/community-client.js";
import { CommunityGallery } from "./community-gallery.js";

/** The Community view: newest first, searched on the server as the user types. */
export function CommunityPage({ slug }: { readonly slug?: string }) {
	const [queryClient] = useState(() => new QueryClient());
	const [query, setQuery] = useState("");
	const searched = useDeferredValue(query.trim());
	const pages = useInfiniteQuery(
		{
			gcTime: 60_000,
			getNextPageParam: (page: CommunityIconPage) => page.nextCursor,
			initialPageParam: undefined as string | undefined,
			// Typing keeps the last results on screen until the new ones arrive.
			placeholderData: keepPreviousData,
			queryFn: ({ pageParam, signal }) =>
				fetchCommunityPage({
					query: searched,
					signal,
					...(pageParam ? { cursor: pageParam } : {}),
				}),
			queryKey: ["community-icons", searched],
			refetchOnWindowFocus: false,
			retry: false,
		},
		queryClient,
	);
	const linked = useQuery(
		{
			enabled: slug !== undefined,
			queryFn: ({ signal }) => fetchCommunityIcon(slug ?? "", signal),
			queryKey: ["community-icon", slug],
			refetchOnWindowFocus: false,
			retry: false,
		},
		queryClient,
	);
	const icons = pages.data?.pages.flatMap((page) => page.icons) ?? [];
	const status = pages.isSuccess
		? "ready"
		: pages.isError && !pages.isFetching
			? "error"
			: "loading";

	// The linked icon opens once it has loaded, so the gallery mounts with it.
	if (slug !== undefined && linked.isPending) {
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
			key="gallery"
			{...(linked.data ? { initialIcon: linked.data } : {})}
			{...(pages.isError
				? {
						errorMessage:
							pages.error instanceof Error
								? pages.error.message
								: "Community icons could not be loaded.",
					}
				: {})}
			hasMore={pages.hasNextPage}
			icons={icons}
			loadingMore={pages.isFetchingNextPage}
			onLoadMore={() => void pages.fetchNextPage()}
			onQueryChange={setQuery}
			onRetry={() => void pages.refetch()}
			query={query}
			status={status}
		/>
	);
}
