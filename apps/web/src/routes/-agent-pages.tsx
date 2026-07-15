import type { ReactNode } from "react";

import {
  AgentSetupView,
  type AgentSetupId,
} from "../components/agent-setup-view/index.js";
import { SiteFooter } from "../components/site-footer/index.js";
import { SiteHeader } from "../components/site-header/index.js";
import type { WebSurfaceUrls } from "../lib/surface-urls";

export interface AgentsShellProps {
  children: ReactNode;
  surfaceUrls: WebSurfaceUrls;
}

export function AgentsShell({ children, surfaceUrls }: AgentsShellProps) {
  return (
    <div className="sketchi-web">
      <SiteHeader activePath="/agents" surfaceUrls={surfaceUrls} />
      <main>{children}</main>
      <SiteFooter surfaceUrls={surfaceUrls} />
    </div>
  );
}

export interface AgentsPageProps {
  surfaceUrls: WebSurfaceUrls;
}

export function AgentsPage({ surfaceUrls }: AgentsPageProps) {
  return (
    <AgentsShell surfaceUrls={surfaceUrls}>
      <AgentSetupView />
    </AgentsShell>
  );
}

export interface AgentDetailPageProps {
  agentId: AgentSetupId;
  surfaceUrls: WebSurfaceUrls;
}

export function AgentDetailPage({
  agentId,
  surfaceUrls,
}: AgentDetailPageProps) {
  return (
    <AgentsShell surfaceUrls={surfaceUrls}>
      <AgentSetupView agentId={agentId} />
    </AgentsShell>
  );
}
