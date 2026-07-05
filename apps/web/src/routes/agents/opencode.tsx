import { createFileRoute } from "@tanstack/react-router";

import { AgentSetupView } from "../../components/agent-setup-view/index.js";
import type { AgentSetupId } from "../../components/agent-setup-view/index.js";

const agentId = "opencode" satisfies AgentSetupId;

export const Route = createFileRoute("/agents/opencode")({
  head: () => ({
    meta: [{ title: "OpenCode setup - Sketchi" }],
  }),
  component: OpenCodeRoute,
});

function OpenCodeRoute() {
  return <AgentSetupView agentId={agentId} />;
}
