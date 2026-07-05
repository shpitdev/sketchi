import { createFileRoute } from "@tanstack/react-router";

import { AgentSetupView } from "../../components/agent-setup-view/index.js";
import type { AgentSetupId } from "../../components/agent-setup-view/index.js";

const agentId = "codex" satisfies AgentSetupId;

export const Route = createFileRoute("/agents/codex")({
  head: () => ({
    meta: [{ title: "Codex setup - Sketchi" }],
  }),
  component: CodexRoute,
});

function CodexRoute() {
  return <AgentSetupView agentId={agentId} />;
}
