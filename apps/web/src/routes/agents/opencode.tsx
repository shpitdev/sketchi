import { createFileRoute } from "@tanstack/react-router";

import { AgentSetupView } from "../../components/agent-setup-view/index.js";
import type { AgentSetupId } from "../../components/agent-setup-view/index.js";
import { pageMeta } from "../../lib/site-meta";

const agentId = "opencode" satisfies AgentSetupId;

export const Route = createFileRoute("/agents/opencode")({
	head: () =>
		pageMeta({
			title: "OpenCode setup – Sketchi",
			description: "Connect OpenCode to the Sketchi MCP server.",
			path: "/agents/opencode",
		}),
	component: OpenCodeRoute,
});

function OpenCodeRoute() {
	return <AgentSetupView agentId={agentId} />;
}
