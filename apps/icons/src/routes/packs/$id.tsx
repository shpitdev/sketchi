import { QueryClient, useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";

import { PackPage } from "../../components/packs/pack-page.js";
import { loadPackIcons } from "../../lib/catalog-client.js";
import { getPackShelf } from "../../lib/packs-rpc.js";

export const Route = createFileRoute("/packs/$id")({
	loader: async ({ params }) => {
		const shelf = await getPackShelf();
		const pack = shelf.packs.find((summary) => summary.id === params.id);
		// oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's 404 is thrown, by design not an Error
		if (!pack) throw notFound();
		return { pack, excalidraw: shelf.excalidraw[pack.id] };
	},
	head: ({ loaderData }) => ({
		meta: loaderData ? [{ title: `${loaderData.pack.name} · Sketchi Icons` }] : [],
	}),
	component: PackRoute,
});

function PackRoute() {
	const { excalidraw, pack } = Route.useLoaderData();
	const [queryClient] = useState(() => new QueryClient());
	const options = { gcTime: 0, refetchOnReconnect: false, refetchOnWindowFocus: false } as const;
	// Only this pack's marks: the whole catalog's manifest and drawings are megabytes.
	const members = useQuery(
		{
			...options,
			queryFn: ({ signal }) => loadPackIcons(pack.id, signal),
			queryKey: ["pack-icons", pack.id],
			retry: 1,
		},
		queryClient,
	);
	const failed = members.isError ? members : undefined;

	return (
		<PackPage
			{...(failed
				? {
						errorMessage:
							failed.error instanceof Error
								? failed.error.message
								: "The icons could not be loaded.",
						onRetry: () => void failed.refetch(),
					}
				: {})}
			{...(excalidraw ? { excalidraw } : {})}
			icons={members.data ?? []}
			pack={pack}
			status={members.isSuccess ? "ready" : failed && !failed.isFetching ? "error" : "loading"}
		/>
	);
}
