import { createFileRoute } from "@tanstack/react-router";

import { AgentSetupView } from "../../components/agent-setup-view/index.js";
import type { AgentSetupId } from "../../components/agent-setup-view/index.js";
import { pageMeta } from "../../lib/site-meta";

const agentId = "antigravity" satisfies AgentSetupId;

export const Route = createFileRoute("/agents/antigravity")({
  head: () =>
    pageMeta({
      title: "Antigravity setup - Sketchi",
      description:
        "Add Sketchi to Antigravity and turn prompts into clean, editable diagrams.",
      path: "/agents/antigravity",
    }),
  component: AntigravityRoute,
});

function AntigravityRoute() {
  return <AgentSetupView agentId={agentId} />;
}
