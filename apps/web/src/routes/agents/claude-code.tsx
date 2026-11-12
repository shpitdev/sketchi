import { createFileRoute } from "@tanstack/react-router";

import { AgentSetupView } from "../../components/agent-setup-view/index.js";
import type { AgentSetupId } from "../../components/agent-setup-view/index.js";
import { pageMeta } from "../../lib/site-meta";

const agentId = "claude-code" satisfies AgentSetupId;

export const Route = createFileRoute("/agents/claude-code")({
	head: () =>
		pageMeta({
			title: "Claude Code setup – Sketchi",
			description:
				"Install the Sketchi plugin in Claude Code so it can draw Excalidraw diagrams when you ask for one.",
			path: "/agents/claude-code",
		}),
	component: ClaudeCodeRoute,
});

function ClaudeCodeRoute() {
	return <AgentSetupView agentId={agentId} />;
}
