import { createFileRoute } from "@tanstack/react-router";

import { MarketingHome } from "../components/marketing-home/index.js";
import { pageMeta } from "../lib/site-meta";
import { getWebSurfaceUrls } from "../lib/surface-urls-rpc";

export const Route = createFileRoute("/")({
	head: () =>
		pageMeta({
			title: "Sketchi: editable diagrams from a prompt",
			description:
				"Describe a diagram and get an editable Excalidraw sketch with real tech logos. Use it in the browser, your coding agent, or the terminal.",
			path: "/",
		}),
	loader: () => getWebSurfaceUrls(),
	component: HomeRoute,
});

function HomeRoute() {
	const surfaceUrls = Route.useLoaderData();

	return <MarketingHome surfaceUrls={surfaceUrls} />;
}
