import { QueryClient, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { IconLibrary } from "../components/icon-library/index.js";
import { loadDrawings, loadIconManifest } from "../lib/catalog-client.js";
import { getPackShelf } from "../lib/packs-rpc.js";

export const Route = createFileRoute("/")({
	// The packs render with the page; without their index the icons still work.
	loader: () => getPackShelf().catch(() => undefined),
	component: HomeRoute,
});

function HomeRoute() {
	const shelf = Route.useLoaderData();
	const [queryClient] = useState(() => new QueryClient());
	// Route-local query: unmounting aborts the manifest request, and retry
	// refetches through the same query instead of a manual attempt counter.
	const manifest = useQuery(
		{
			gcTime: 0,
			queryFn: ({ signal }) => loadIconManifest(signal),
			queryKey: ["icons-manifest"],
			refetchOnReconnect: false,
			refetchOnWindowFocus: false,
			retry: false,
		},
		queryClient,
	);
	// Fetched once the grid can show: the drawings only add a view and the detail's drawing,
	// so a failed load leaves the SVG library as it is.
	const drawings = useQuery(
		{
			enabled: manifest.isSuccess,
			gcTime: 0,
			queryFn: ({ signal }) => loadDrawings(signal),
			queryKey: ["icon-drawings"],
			refetchOnReconnect: false,
			refetchOnWindowFocus: false,
			retry: 1,
		},
		queryClient,
	);

	return (
		<IconLibrary
			{...(manifest.isSuccess ? { data: manifest.data } : {})}
			{...(drawings.isSuccess ? { drawings: drawings.data } : {})}
			{...(shelf ? { packs: shelf } : {})}
			{...(manifest.isError
				? {
						errorMessage:
							manifest.error instanceof Error
								? manifest.error.message
								: "The icon library could not be loaded.",
					}
				: {})}
			onRetry={() => void manifest.refetch()}
			status={
				manifest.isSuccess
					? "ready"
					: manifest.isError && !manifest.isFetching
						? "error"
						: "loading"
			}
		/>
	);
}
