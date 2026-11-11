import { QueryClient, useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { PackPage } from "../../components/packs/pack-page.js";
import { loadDrawings, loadIconManifest } from "../../lib/catalog-client.js";
import { findPack, packIcons } from "../../lib/packs.js";
import { getPackShelf } from "../../lib/packs-rpc.js";

export const Route = createFileRoute("/packs/$id")({
	loader: async ({ params }) => {
		const shelf = await getPackShelf();
		const pack = shelf.packs.find((summary) => summary.id === params.id);
		// oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's 404 is thrown, by design not an Error
		if (!pack) throw notFound();
		return { origin: shelf.origin, pack };
	},
	head: ({ loaderData }) => ({
		meta: loaderData ? [{ title: `${loaderData.pack.name} · Sketchi Icons` }] : [],
	}),
	component: PackRoute,
});

function PackRoute() {
	const { origin, pack } = Route.useLoaderData();
	const [queryClient] = useState(() => new QueryClient());
	const options = { gcTime: 0, refetchOnReconnect: false, refetchOnWindowFocus: false } as const;
	const manifest = useQuery(
		{
			...options,
			queryFn: ({ signal }) => loadIconManifest(signal),
			queryKey: ["icons-manifest"],
			retry: false,
		},
		queryClient,
	);
	const drawings = useQuery(
		{
			...options,
			queryFn: ({ signal }) => loadDrawings(signal),
			queryKey: ["icon-drawings"],
			retry: 1,
		},
		queryClient,
	);
	const definition = findPack(pack.id);
	const icons = useMemo(
		() =>
			definition && manifest.data && drawings.data
				? packIcons(definition, manifest.data.icons, drawings.data)
				: [],
		[definition, drawings.data, manifest.data],
	);
	const failed = manifest.isError ? manifest : drawings.isError ? drawings : undefined;

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
			icons={icons}
			origin={origin}
			pack={pack}
			status={
				manifest.isSuccess && drawings.isSuccess
					? "ready"
					: failed && !failed.isFetching
						? "error"
						: "loading"
			}
		/>
	);
}
