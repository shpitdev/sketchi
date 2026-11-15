import { useAtomValue, useAtomRefresh } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { createFileRoute } from "@tanstack/react-router";

import { IconLibrary } from "../features/catalog/icon-library.js";
import { drawingsQuery, manifestQuery, queryError, queryStatus } from "../lib/query-atoms.js";
import { getPackShelf } from "../lib/packs-rpc.js";

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
