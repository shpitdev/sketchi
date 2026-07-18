import { createFileRoute } from "@tanstack/react-router";

import { MarketingHome } from "../components/marketing-home/index.js";
import { pageMeta } from "../lib/site-meta";
import { getWebSurfaceUrls } from "../lib/surface-urls-rpc";

export const Route = createFileRoute("/")({
  head: () =>
    pageMeta({
      title: "Sketchi: describe it, and Sketchi draws it",
      description:
        "Describe it and Sketchi draws it: turn a prompt into a clean, editable diagram, complete with the real logos of your stack. In the playground or inside your coding agent.",
      path: "/",
    }),
  loader: () => getWebSurfaceUrls(),
  component: HomeRoute,
});

function HomeRoute() {
  const surfaceUrls = Route.useLoaderData();

  return <MarketingHome surfaceUrls={surfaceUrls} />;
}
