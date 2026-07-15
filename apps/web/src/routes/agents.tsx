import {
  Outlet,
  createFileRoute,
  useRouterState,
} from "@tanstack/react-router";

import { AgentSetupView } from "../components/agent-setup-view/index.js";
import { AgentsShell } from "./-agent-pages.js";
import { getWebSurfaceUrls } from "../lib/surface-urls-rpc";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [{ title: "Agent setup - Sketchi" }],
  }),
  loader: () => getWebSurfaceUrls(),
  component: AgentsRoute,
});

function AgentsRoute() {
  const surfaceUrls = Route.useLoaderData();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <AgentsShell surfaceUrls={surfaceUrls}>
      {pathname === "/agents" ? <AgentSetupView /> : <Outlet />}
    </AgentsShell>
  );
}
