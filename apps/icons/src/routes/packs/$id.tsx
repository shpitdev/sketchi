import { useAtomValue, useAtomRefresh } from "@effect/atom-react";
import { Array, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { PackPage } from "../../features/packs/pack-page";
import { queryError, queryStatus } from "../../features/browser/query";
import { packQuery } from "../../features/packs/queries";
import { packPagePath } from "../../features/packs/packs";
import { packDescription, packImage } from "../../features/packs/meta";
import { pageMeta } from "../../shared/site";
import { getPackShelf } from "../../features/packs/shelf";

export const Route = createFileRoute("/packs/$id")({
	// @effect-diagnostics-next-line asyncFunction:off -- TanStack route loader owns this existing server-function Promise boundary.
	loader: async ({ params }) => {
		const shelf = await getPackShelf();
		const pack = Option.getOrUndefined(
			Array.findFirst(shelf.packs, (summary) => summary.id === params.id),
		);
		// oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's 404 is thrown, by design not an Error
		if (!pack) throw notFound();
		return { pack, excalidraw: shelf.excalidraw[pack.id] };
	},
	head: ({ loaderData }) => ({
		meta: loaderData
			? pageMeta({
					title: `${loaderData.pack.name} · Sketchi Icons`,
					description: packDescription(loaderData.pack),
					path: packPagePath(loaderData.pack.id),
					image: packImage(loaderData.pack),
				})
			: [],
	}),
	component: PackRoute,
});

function PackRoute() {
	const { excalidraw, pack } = Route.useLoaderData();
	const members = useAtomValue(packQuery(pack.id));
	const retry = useAtomRefresh(packQuery(pack.id));

	return (
		<PackPage
			{...(AsyncResult.isFailure(members)
				? {
						errorMessage: queryError(members, "The icons could not be loaded."),
						onRetry: retry,
					}
				: {})}
			{...(excalidraw ? { excalidraw } : {})}
			icons={Option.getOrElse(AsyncResult.value(members), () => [])}
			pack={pack}
			status={queryStatus(members)}
		/>
	);
}
