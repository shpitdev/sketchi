import { createFileRoute } from "@tanstack/react-router";

import { AgentSetupView } from "../../components/agent-setup-view/index.js";
import type { AgentSetupId } from "../../components/agent-setup-view/index.js";
import { pageMeta } from "../../lib/site-meta";

const agentId = "claude-code" satisfies AgentSetupId;

export const Route = createFileRoute("/agents/claude-code")({
  head: () =>
    pageMeta({
      title: "Claude Code setup - Sketchi",
      description:
        "Add Sketchi to Claude Code and turn prompts into clean, editable diagrams.",
      path: "/agents/claude-code",
    }),
  component: ClaudeCodeRoute,
});

function ClaudeCodeRoute() {
  return <AgentSetupView agentId={agentId} />;
}
