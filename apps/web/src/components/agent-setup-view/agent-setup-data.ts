const mcpEndpoint = "https://sketchi-studio.dimethyl.workers.dev/mcp";

export type AgentSetupId =
  | "codex"
  | "opencode"
  | "claude-code"
  | "antigravity";

export interface AgentSetupCommand {
  label: string;
  value: string;
}

export interface AgentSetupEntry {
  commands: readonly AgentSetupCommand[];
  config?: string;
  href: `/agents/${AgentSetupId}`;
  id: AgentSetupId;
  name: string;
  notes: readonly string[];
  status: string;
  summary: string;
}

export const agentSetupEntries: readonly AgentSetupEntry[] = [
  {
    commands: [
      {
        label: "Register this repo as a Codex plugin marketplace",
        value: "codex plugin marketplace add .",
      },
      {
        label: "Install the packaged Sketchi Code Mode plugin",
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
    id: "codex",
    name: "Codex",
    notes: [
      "The plugin manifest declares the Sketchi Code Mode skill, UI metadata, and remote MCP dependency.",
      "The Codex CLI command surface was checked locally: plugin marketplaces use `codex plugin marketplace add`, then `codex plugin add`.",
    ],
    status: "Packaged plugin",
    summary:
      "Install the repo-local Codex plugin package for the Sketchi Code Mode skill and streamable HTTP MCP server.",
  },
  {
    commands: [
      {
        label: "Add the remote MCP server",
        value: `opencode mcp add sketchi-code-mode --url ${mcpEndpoint}`,
      },
      {
        label: "Confirm OpenCode can see the server",
        value: "opencode mcp list",
      },
    ],
    href: "/agents/opencode",
    id: "opencode",
    name: "OpenCode",
    notes: [
      "This checkout proves OpenCode as an external client over Sketchi Code Mode MCP.",
      "There is no tracked OpenCode plugin package in this repo yet, so setup is manual MCP configuration.",
    ],
    status: "Manual MCP setup",
    summary:
      "Connect OpenCode directly to the same no-auth Sketchi Code Mode MCP endpoint used by supported agents.",
  },
  {
    commands: [
      {
        label: "Register this repo as a Claude Code plugin marketplace",
        value: "claude plugin marketplace add . --scope local",
      },
      {
        label: "Install the packaged Claude Code plugin",
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
    id: "claude-code",
    name: "Claude Code",
    notes: [
      "The plugin manifest points Claude Code at the bundled skill and `.mcp.json` server config.",
      "After installation the skill loads as `/sketchi-code-mode-claude:sketchi-code-mode`.",
    ],
    status: "Packaged plugin",
    summary:
      "Install the Claude Code plugin package that bundles the Sketchi skill and remote MCP server.",
  },
  {
    commands: [
      {
        label: "Install the reusable Antigravity plugin from this repo",
        value: "agy plugin install ./plugins/sketchi-code-mode-antigravity",
      },
      {
        label: "Confirm the plugin is installed",
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
    id: "antigravity",
    name: "Google Antigravity",
    notes: [
      "Launching `agy` from this repository also loads the workspace MCP config and workspace skill.",
      "Use a normal authenticated Antigravity session when asking Sketchi Code Mode to create diagrams.",
    ],
    status: "Packaged plugin",
    summary:
      "Install the Antigravity plugin or use the workspace config already tracked in this repository.",
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
