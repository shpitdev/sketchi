import { createFileRoute } from "@tanstack/react-router";

import { DocsView } from "../components/docs-view/index.js";
import { SiteShell } from "../components/site-shell/site-shell.js";
import { pageMeta } from "../lib/site-meta";
import { getWebSurfaceUrls } from "../lib/surface-urls-rpc";

export const Route = createFileRoute("/docs")({
  head: () =>
    pageMeta({
      title: "Docs - Sketchi",
      description:
        "Learn how to create and edit Sketchi diagrams in the playground, your coding agent, or the sketchi CLI.",
      path: "/docs",
    }),
  loader: () => getWebSurfaceUrls(),
  component: DocsRoute,
});

function DocsRoute() {
  const surfaceUrls = Route.useLoaderData();
  return (
    <SiteShell activePath="/docs" surfaceUrls={surfaceUrls}>
      <DocsView surfaceUrls={surfaceUrls} />
    </SiteShell>
  );
}
