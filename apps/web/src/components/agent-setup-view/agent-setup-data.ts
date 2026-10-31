const mcpEndpoint = "https://playground.sketchi.app/mcp";
const portableSkillUrl =
	"https://raw.githubusercontent.com/shpitdev/sketchi/main/.agents/skills/sketchi-code-mode/SKILL.md";
const firstDiagram =
	"Create a top-to-bottom request approval flowchart and return the hosted Excalidraw and PNG artifacts.";
const portableFirstDiagram =
	"Use the sketchi-code-mode skill to create a top-to-bottom flowchart for request intake, review, approval or revision, and completion. Return the hosted Excalidraw and PNG artifacts.";

export type AgentSetupId = "codex" | "opencode" | "claude-code" | "antigravity";

export interface AgentSetupStep {
	label: string;
	/**
	 * What the copy button writes. `shell` steps must run as pasted: long
	 * commands continue onto the next line with a trailing backslash.
	 */
	value: string;
	/** `shell` and `json` keep their lines; `prompt` is sent in the agent's chat. */
	kind: "shell" | "json" | "prompt";
}

export interface AgentSetupEntry {
	/** Brand accent used to tint the agent tile. */
	accent: string;
	/** How Sketchi installs: a packaged plugin, or a skill plus the MCP server. */
	badge: "Plugin" | "MCP";
	href: `/agents/${AgentSetupId}`;
	/** Path to the agent's brand icon in /public. */
	icon: `/agents/${AgentSetupId}.svg`;
	id: AgentSetupId;
	name: string;
	steps: readonly AgentSetupStep[];
}

export const agentSetupEntries: readonly AgentSetupEntry[] = [
	{
		accent: "#3941ff",
		badge: "Plugin",
		href: "/agents/codex",
		icon: "/agents/codex.svg",
		id: "codex",
		name: "Codex",
		steps: [
			{
				label: "Add the marketplace",
				value: "codex plugin marketplace add shpitdev/sketchi",
				kind: "shell",
			},
			{
				label: "Install the plugin",
				value: "codex plugin add sketchi-code-mode-codex@sketchi-agent-plugins",
				kind: "shell",
			},
			{
				label: "Verify",
				value: "codex mcp get sketchi-code-mode",
				kind: "shell",
			},
			{
				label: "Ask Codex for a diagram",
				value: `$sketchi-code-mode ${firstDiagram}`,
				kind: "prompt",
			},
		],
	},
	{
		accent: "#1a1712",
		badge: "MCP",
		href: "/agents/opencode",
		icon: "/agents/opencode.svg",
		id: "opencode",
		name: "OpenCode",
		steps: [
			{
				label: "Add the skill",
				value: `SKETCHI_SKILL_DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/opencode/skills/sketchi-code-mode"
mkdir -p "$SKETCHI_SKILL_DIR"
curl -fsSL -o "$SKETCHI_SKILL_DIR/SKILL.md" \\
  ${portableSkillUrl}`,
				kind: "shell",
			},
			{
				label: "Connect the server",
				value: `opencode mcp add sketchi-code-mode \\
  --url ${mcpEndpoint}`,
				kind: "shell",
			},
			{
				label: "Restart OpenCode, then verify",
				value: "opencode mcp list",
				kind: "shell",
			},
			{
				label: "Ask OpenCode for a diagram",
				value: portableFirstDiagram,
				kind: "prompt",
			},
		],
	},
	{
		accent: "#d97757",
		badge: "Plugin",
		href: "/agents/claude-code",
		icon: "/agents/claude-code.svg",
		id: "claude-code",
		name: "Claude Code",
		steps: [
			{
				label: "Add the marketplace",
				value: "claude plugin marketplace add shpitdev/sketchi",
				kind: "shell",
			},
			{
				label: "Install the plugin",
				value: "claude plugin install sketchi-code-mode-claude@sketchi-agent-plugins",
				kind: "shell",
			},
			{
				label: "Verify",
				value: "claude plugin details sketchi-code-mode-claude@sketchi-agent-plugins",
				kind: "shell",
			},
			{
				label: "Ask Claude Code for a diagram",
				value: `/sketchi-code-mode-claude:sketchi-code-mode ${firstDiagram}`,
				kind: "prompt",
			},
		],
	},
	{
		accent: "#3186ff",
		badge: "MCP",
		href: "/agents/antigravity",
		icon: "/agents/antigravity.svg",
		id: "antigravity",
		name: "Antigravity",
		steps: [
			{
				label: "Add the skill to your project",
				value: `mkdir -p .agents/skills/sketchi-code-mode
curl -fsSL -o .agents/skills/sketchi-code-mode/SKILL.md \\
  ${portableSkillUrl}`,
				kind: "shell",
			},
			{
				label: "Merge into .agents/mcp_config.json",
				value: `{
  "mcpServers": {
    "sketchi-code-mode": {
      "serverUrl": "${mcpEndpoint}"
    }
  }
}`,
				kind: "json",
			},
			{
				label: "Ask Antigravity for a diagram",
				value: portableFirstDiagram,
				kind: "prompt",
			},
		],
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
