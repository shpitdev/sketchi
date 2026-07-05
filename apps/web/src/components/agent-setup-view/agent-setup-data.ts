const mcpEndpoint = "https://sketchi-studio.dimethyl.workers.dev/mcp";

export type AgentSetupId = "codex" | "opencode" | "claude-code" | "antigravity";

export interface AgentSetupCommand {
  label: string;
  value: string;
}

export interface AgentSetupEntry {
  /** Brand accent used to tint the agent tile. */
  accent: string;
  commands: readonly AgentSetupCommand[];
  config?: string;
  href: `/agents/${AgentSetupId}`;
  /** Path to the agent's brand icon in /public. */
  icon: `/agents/${AgentSetupId}.svg`;
  id: AgentSetupId;
  name: string;
  notes: readonly string[];
  status: string;
  summary: string;
  /** Short, one-line description of who makes the agent. */
  tagline: string;
}

export const agentSetupEntries: readonly AgentSetupEntry[] = [
  {
    accent: "#3941ff",
    commands: [
      {
        label: "Add the Sketchi plugin marketplace",
        value: "codex plugin marketplace add .",
      },
      {
        label: "Install the Sketchi plugin",
        value:
          "codex plugin add sketchi-code-mode-codex --marketplace sketchi-agent-plugins",
      },
    ],
    config: `{
  "mcpServers": {
    "sketchi-code-mode": {
      "type": "http",
      "url": "${mcpEndpoint}"
    }
  }
}`,
    href: "/agents/codex",
    icon: "/agents/codex.svg",
    id: "codex",
    name: "Codex",
    notes: [
      "Sketchi installs as a Codex plugin, so the diagram skill is always one command away.",
      "Diagrams come back as editable Sketchi artifacts you can reopen later.",
    ],
    status: "Plugin",
    summary:
      "Install the Sketchi plugin and ask Codex to diagram anything you're building.",
    tagline: "OpenAI's coding agent",
  },
  {
    accent: "#1a1712",
    commands: [
      {
        label: "Connect the Sketchi server",
        value: `opencode mcp add sketchi-code-mode --url ${mcpEndpoint}`,
      },
      {
        label: "Confirm the connection",
        value: "opencode mcp list",
      },
    ],
    href: "/agents/opencode",
    icon: "/agents/opencode.svg",
    id: "opencode",
    name: "OpenCode",
    notes: [
      "No plugin to install — OpenCode talks to Sketchi over a single server URL.",
      "Run the list command any time to confirm the connection is live.",
    ],
    status: "Connect",
    summary:
      "Point OpenCode at Sketchi and generate diagrams without leaving the terminal.",
    tagline: "Open-source terminal agent",
  },
  {
    accent: "#d97757",
    commands: [
      {
        label: "Add the Sketchi plugin marketplace",
        value: "claude plugin marketplace add . --scope local",
      },
      {
        label: "Install the Sketchi plugin",
        value:
          "claude plugin install sketchi-code-mode-claude@sketchi-agent-plugins",
      },
    ],
    config: `{
  "mcpServers": {
    "sketchi-code-mode": {
      "type": "http",
      "url": "${mcpEndpoint}"
    }
  }
}`,
    href: "/agents/claude-code",
    icon: "/agents/claude-code.svg",
    id: "claude-code",
    name: "Claude Code",
    notes: [
      "The plugin bundles the Sketchi skill, so you can ask for a diagram in plain language.",
      "Diagrams open as editable Sketchi artifacts, not throwaway files.",
    ],
    status: "Plugin",
    summary:
      "Add the Sketchi plugin to Claude Code and turn any explanation into a diagram.",
    tagline: "Anthropic's coding agent",
  },
  {
    accent: "#3186ff",
    commands: [
      {
        label: "Install the Sketchi plugin",
        value: "agy plugin install ./plugins/sketchi-code-mode-antigravity",
      },
      {
        label: "Confirm it's installed",
        value: "agy plugin list",
      },
    ],
    config: `{
  "mcpServers": {
    "sketchi-code-mode": {
      "serverUrl": "${mcpEndpoint}"
    }
  }
}`,
    href: "/agents/antigravity",
    icon: "/agents/antigravity.svg",
    id: "antigravity",
    name: "Antigravity",
    notes: [
      "Install once and every Antigravity session can reach Sketchi.",
      "Use your normal signed-in session — Sketchi handles the diagram.",
    ],
    status: "Plugin",
    summary:
      "Install the Sketchi plugin for Antigravity and sketch systems as you build them.",
    tagline: "Google's agent IDE",
  },
] satisfies readonly AgentSetupEntry[];

const agentSetupById: ReadonlyMap<AgentSetupId, AgentSetupEntry> = new Map(
  agentSetupEntries.map((entry) => [entry.id, entry]),
);

export function getAgentSetupEntry(agentId: AgentSetupId): AgentSetupEntry {
  const entry = agentSetupById.get(agentId);

  if (entry === undefined) {
    throw new Error(`Unknown agent setup id: ${agentId}`);
  }

  return entry;
}

export const codeModeMcpEndpoint = mcpEndpoint;
