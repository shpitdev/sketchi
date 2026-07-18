import {
  Outlet,
  createFileRoute,
  useRouterState,
} from "@tanstack/react-router";

import { AgentSetupView } from "../components/agent-setup-view/index.js";
import { AgentsShell } from "./-agent-pages.js";
import { pageMeta } from "../lib/site-meta";
import { getWebSurfaceUrls } from "../lib/surface-urls-rpc";

export const Route = createFileRoute("/agents")({
  // Layout route for /agents and its children. Only the deepest matched route
  // should emit a canonical (TanStack rel-dedupes links only when identical,
  // so two different canonicals would both ship). Emit one here when /agents
  // is itself the leaf; when a child agent page is active it owns the
  // canonical instead.
  head: (ctx) => {
    const isLeafMatch =
      ctx.matches[ctx.matches.length - 1]?.id === ctx.match.id;
    return pageMeta({
      title: "Agent setup - Sketchi",
      description:
        "Add Sketchi to your coding agent — Claude Code, Codex, OpenCode, or Antigravity — and draw diagrams straight from your prompts.",
      path: "/agents",
      canonical: isLeafMatch,
    });
  },
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
