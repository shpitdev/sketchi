import { createFileRoute } from "@tanstack/react-router";

import { AgentSetupView } from "../../components/agent-setup-view/index.js";
import type { AgentSetupId } from "../../components/agent-setup-view/index.js";
import { pageMeta } from "../../lib/site-meta";

const agentId = "opencode" satisfies AgentSetupId;

export const Route = createFileRoute("/agents/opencode")({
  head: () =>
    pageMeta({
      title: "OpenCode setup - Sketchi",
      description:
        "Add Sketchi to OpenCode and turn prompts into clean, editable diagrams.",
      path: "/agents/opencode",
    }),
  component: OpenCodeRoute,
});

function OpenCodeRoute() {
  return <AgentSetupView agentId={agentId} />;
}
