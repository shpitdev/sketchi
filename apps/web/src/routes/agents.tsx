import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";

import { AgentSetupView } from "../components/agent-setup-view/index.js";
import { SiteShell } from "../components/site-shell/site-shell.js";
import { pageMeta } from "../lib/site-meta";
import { getWebSurfaceUrls } from "../lib/surface-urls-rpc";

export const Route = createFileRoute("/agents")({
	// Layout route for /agents and its children. Only the deepest matched route
	// should emit a canonical (TanStack rel-dedupes links only when identical,
	// so two different canonicals would both ship). Emit one here when /agents
	// is itself the leaf; when a child agent page is active it owns the
	// canonical instead.
	head: (ctx) => {
		const isLeafMatch = ctx.matches[ctx.matches.length - 1]?.id === ctx.match.id;
		return pageMeta({
			title: "Agent setup - Sketchi",
			description:
				"Set up Sketchi in Claude Code, Codex, OpenCode, or Antigravity to draw diagrams from prompts.",
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
		<SiteShell activePath="/agents" surfaceUrls={surfaceUrls}>
			{pathname === "/agents" ? <AgentSetupView /> : <Outlet />}
		</SiteShell>
	);
}
