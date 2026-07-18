import { createFileRoute } from "@tanstack/react-router";

import { DocsView } from "../components/docs-view/index.js";
import { SiteFooter } from "../components/site-footer/index.js";
import { SiteHeader } from "../components/site-header/index.js";
import { pageMeta } from "../lib/site-meta";
import type { WebSurfaceUrls } from "../lib/surface-urls";
import { getWebSurfaceUrls } from "../lib/surface-urls-rpc";

export const Route = createFileRoute("/docs")({
  head: () =>
    pageMeta({
      title: "Docs - Sketchi",
      description:
        "How Sketchi works: turn a plain-language prompt into a clean, editable diagram, in the playground or inside your coding agent.",
      path: "/docs",
    }),
  loader: () => getWebSurfaceUrls(),
  component: DocsRoute,
});

function DocsRoute() {
  const surfaceUrls = Route.useLoaderData();

  return <DocsPage surfaceUrls={surfaceUrls} />;
}

export interface DocsPageProps {
  surfaceUrls: WebSurfaceUrls;
}

export function DocsPage({ surfaceUrls }: DocsPageProps) {
  return (
    <div className="sketchi-web">
      <SiteHeader activePath="/docs" surfaceUrls={surfaceUrls} />
      <main>
        <DocsView surfaceUrls={surfaceUrls} />
      </main>
      <SiteFooter surfaceUrls={surfaceUrls} />
    </div>
  );
}
