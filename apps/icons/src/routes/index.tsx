import { QueryClient, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { IconLibrary } from "../components/icon-library/index.js";
import { decodeDrawings, DRAWINGS_PATH, type IconDrawings } from "../lib/drawings.js";
import { decodeIconManifest, type IconManifest } from "@sketchi/icon-catalog";

export const Route = createFileRoute("/")({
	component: HomeRoute,
});

async function loadIconManifest(signal: AbortSignal): Promise<IconManifest> {
	// Revalidate: a manifest cached before a deploy may predate fields this page reads.
	const response = await fetch("/icons-manifest.json", { cache: "no-cache", signal });
	if (!response.ok) {
		throw new Error(`Icon library returned HTTP ${response.status}.`);
	}
	const payload: unknown = await response.json();
	return decodeIconManifest(payload);
}

async function loadDrawings(signal: AbortSignal): Promise<IconDrawings> {
	const response = await fetch(DRAWINGS_PATH, { cache: "no-cache", signal });
	if (!response.ok) throw new Error(`Drawings returned HTTP ${response.status}.`);
	return decodeDrawings(await response.json());
}

function HomeRoute() {
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
