import { createFileRoute } from "@tanstack/react-router";

import { AgentSetupView } from "../../components/agent-setup-view/index.js";
import type { AgentSetupId } from "../../components/agent-setup-view/index.js";

const agentId = "antigravity" satisfies AgentSetupId;

export const Route = createFileRoute("/agents/antigravity")({
  head: () => ({
    meta: [{ title: "Antigravity setup - Sketchi" }],
  }),
  component: AntigravityRoute,
});

function AntigravityRoute() {
  return <AgentSetupView agentId={agentId} />;
}
