import { createFileRoute } from "@tanstack/react-router";

import { MarketingHome } from "../components/marketing-home/index.js";
import { pageMeta, SITE_DESCRIPTION } from "../lib/site-meta";
import { getWebSurfaceUrls } from "../lib/surface-urls-rpc";

export const Route = createFileRoute("/")({
	head: () =>
		pageMeta({
			title: "Sketchi: Excalidraw diagrams from a description",
			description: SITE_DESCRIPTION,
			path: "/",
		}),
	loader: () => getWebSurfaceUrls(),
	component: HomeRoute,
});

function HomeRoute() {
	const surfaceUrls = Route.useLoaderData();

	return <MarketingHome surfaceUrls={surfaceUrls} />;
}
