import { createFileRoute } from "@tanstack/react-router";

import { MarketingHome } from "../components/marketing-home/index.js";
import { getWebSurfaceUrls } from "../lib/surface-urls-rpc";

export const Route = createFileRoute("/")({
  loader: () => getWebSurfaceUrls(),
  component: HomeRoute,
});

function HomeRoute() {
  const surfaceUrls = Route.useLoaderData();

  return <MarketingHome surfaceUrls={surfaceUrls} />;
}
