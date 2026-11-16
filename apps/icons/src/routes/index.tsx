import { useAtomValue, useAtomRefresh } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { createFileRoute } from "@tanstack/react-router";

import { IconLibrary } from "../features/catalog/icon-library";
import { queryError, queryStatus } from "../features/browser/query";
import { drawingsQuery, manifestQuery } from "../features/catalog/queries";
import { getPackShelf } from "../features/packs/shelf";

export const Route = createFileRoute("/")({
	// The packs render with the page; without their index the icons still work.
	loader: () => getPackShelf().catch(() => undefined),
	component: HomeRoute,
});

function HomeRoute() {
	const shelf = Route.useLoaderData();
	const manifest = useAtomValue(manifestQuery);
	const drawings = useAtomValue(drawingsQuery);
	const retry = useAtomRefresh(manifestQuery);

	return (
		<IconLibrary
			{...(AsyncResult.isSuccess(manifest) ? { data: manifest.value } : {})}
			{...(AsyncResult.isSuccess(drawings) ? { drawings: drawings.value } : {})}
			{...(shelf ? { packs: shelf } : {})}
			{...(AsyncResult.isFailure(manifest)
				? {
						errorMessage: queryError(manifest, "The icon library could not be loaded."),
					}
				: {})}
			onRetry={retry}
			status={queryStatus(manifest)}
		/>
	);
}
