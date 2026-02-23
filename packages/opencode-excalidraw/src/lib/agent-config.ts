import { appendSketchiDiagramAgentPrompt } from "./agent-hints";

export const SKETCHI_DIAGRAM_AGENT_ID = "sketchi-diagram";

const DIAGRAM_TOOL_IDS = [
  "diagram_from_prompt",
  "diagram_tweak",
  "diagram_restructure",
  "diagram_to_png",
  "diagram_grade",
] as const;

const DEFAULT_SKETCHI_DIAGRAM_DESCRIPTION =
  "Use for Excalidraw diagram generation, edits, exports, and grading. Prefer this over Mermaid when diagram tools are available.";

type AgentDefinition = Record<string, unknown>;
type AgentRegistry = Record<string, AgentDefinition | undefined>;
interface PluginConfig {
  agent?: AgentRegistry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function mergeDiagramTools(value: unknown): Record<string, boolean> {
  const merged: Record<string, boolean> = {};

  if (isRecord(value)) {
    for (const [toolID, enabled] of Object.entries(value)) {
      if (typeof enabled === "boolean") {
        merged[toolID] = enabled;
      }
    }
  }

  for (const toolID of DIAGRAM_TOOL_IDS) {
    if (merged[toolID] === undefined) {
      merged[toolID] = true;
    }
  }

  return merged;
}

export function applySketchiDiagramAgentConfig(config: PluginConfig): void {
  const agentRegistry: AgentRegistry = config.agent ? { ...config.agent } : {};
  const existingAgent = isRecord(agentRegistry[SKETCHI_DIAGRAM_AGENT_ID])
    ? agentRegistry[SKETCHI_DIAGRAM_AGENT_ID]
    : {};

  const prompt = appendSketchiDiagramAgentPrompt(
    asOptionalString(existingAgent.prompt)
  );

  agentRegistry[SKETCHI_DIAGRAM_AGENT_ID] = {
    ...existingAgent,
    mode: asOptionalString(existingAgent.mode) ?? "subagent",
    hidden: asOptionalBoolean(existingAgent.hidden) ?? false,
    description:
      asOptionalString(existingAgent.description) ??
      DEFAULT_SKETCHI_DIAGRAM_DESCRIPTION,
    prompt,
    tools: mergeDiagramTools(existingAgent.tools),
  };

  config.agent = agentRegistry;
}
