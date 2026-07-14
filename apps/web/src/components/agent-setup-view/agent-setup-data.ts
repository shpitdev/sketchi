const mcpEndpoint = "https://sketchi-studio.dimethyl.workers.dev/mcp";
const portableSkillUrl =
  "https://raw.githubusercontent.com/shpitdev/sketchi-v2/main/.agents/skills/sketchi-code-mode/SKILL.md";

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
  configLabel?: string;
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
        value: "codex plugin marketplace add shpitdev/sketchi-v2",
      },
      {
        label: "Install the Sketchi plugin",
        value: "codex plugin add sketchi-code-mode-codex@sketchi-agent-plugins",
      },
      {
        label: "Verify the MCP server",
        value: "codex mcp get sketchi-code-mode",
      },
      {
        label: "Create your first diagram in a new Codex session",
        value:
          "$sketchi-code-mode Create a top-to-bottom request approval flowchart and return the hosted Excalidraw and PNG artifacts.",
      },
    ],
    href: "/agents/codex",
    icon: "/agents/codex.svg",
    id: "codex",
    name: "Codex",
    notes: [
      "Sketchi installs as a Codex plugin, so the diagram skill is always one command away.",
      "Sketchi needs no separate account, API key, or local browser install.",
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
        label: "Copy the portable Sketchi skill",
        value: `SKETCHI_SKILL_DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/opencode/skills/sketchi-code-mode"
mkdir -p "$SKETCHI_SKILL_DIR"
curl -fsSL ${portableSkillUrl} -o "$SKETCHI_SKILL_DIR/SKILL.md"`,
      },
      {
        label: "Connect the public Sketchi server",
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
      "Sketchi setup stops after the portable skill and public MCP server are configured.",
      "Sketchi needs no separate account, API key, or local browser install; provider and model behavior remain OpenCode concerns.",
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
        value: "claude plugin marketplace add shpitdev/sketchi-v2",
      },
      {
        label: "Install the Sketchi plugin",
        value:
          "claude plugin install sketchi-code-mode-claude@sketchi-agent-plugins",
      },
      {
        label: "Verify the plugin",
        value:
          "claude plugin details sketchi-code-mode-claude@sketchi-agent-plugins",
      },
      {
        label: "Create your first diagram in a new Claude Code session",
        value:
          "/sketchi-code-mode-claude:sketchi-code-mode Create a top-to-bottom request approval flowchart and return the hosted Excalidraw and PNG artifacts.",
      },
    ],
    href: "/agents/claude-code",
    icon: "/agents/claude-code.svg",
    id: "claude-code",
    name: "Claude Code",
    notes: [
      "The plugin bundles the Sketchi skill, so you can ask for a diagram in plain language.",
      "Sketchi needs no separate account, API key, or local browser install.",
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
        label: "Copy the portable Sketchi skill into your project",
        value: `mkdir -p .agents/skills/sketchi-code-mode
curl -fsSL ${portableSkillUrl} -o .agents/skills/sketchi-code-mode/SKILL.md`,
      },
    ],
    config: `{
  "mcpServers": {
    "sketchi-code-mode": {
      "serverUrl": "${mcpEndpoint}"
    }
  }
}`,
    configLabel: "Save or merge .agents/mcp_config.json",
    href: "/agents/antigravity",
    icon: "/agents/antigravity.svg",
    id: "antigravity",
    name: "Antigravity",
    notes: [
      "Save the JSON as .agents/mcp_config.json, merging the sketchi-code-mode server into any existing mcpServers object instead of overwriting it.",
      "Sketchi setup stops after the portable skill and public MCP server are configured.",
      "Sketchi needs no separate account, API key, or local browser install; model and harness behavior remain Agy concerns.",
    ],
    status: "Connect",
    summary:
      "Copy the Sketchi skill and point Agy at the public Code Mode server.",
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
