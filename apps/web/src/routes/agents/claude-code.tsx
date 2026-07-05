import { createFileRoute } from "@tanstack/react-router";

import { AgentSetupView } from "../../components/agent-setup-view/index.js";
import type { AgentSetupId } from "../../components/agent-setup-view/index.js";

const agentId = "claude-code" satisfies AgentSetupId;

export const Route = createFileRoute("/agents/claude-code")({
  head: () => ({
    meta: [{ title: "Claude Code setup - Sketchi" }],
  }),
  component: ClaudeCodeRoute,
});

function ClaudeCodeRoute() {
  return <AgentSetupView agentId={agentId} />;
}
