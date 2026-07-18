import { createFileRoute } from "@tanstack/react-router";

import { AgentSetupView } from "../../components/agent-setup-view/index.js";
import type { AgentSetupId } from "../../components/agent-setup-view/index.js";
import { pageMeta } from "../../lib/site-meta";

const agentId = "codex" satisfies AgentSetupId;

export const Route = createFileRoute("/agents/codex")({
  head: () =>
    pageMeta({
      title: "Codex setup - Sketchi",
      description:
        "Add Sketchi to Codex and turn prompts into clean, editable diagrams.",
      path: "/agents/codex",
    }),
  component: CodexRoute,
});

function CodexRoute() {
  return <AgentSetupView agentId={agentId} />;
}
