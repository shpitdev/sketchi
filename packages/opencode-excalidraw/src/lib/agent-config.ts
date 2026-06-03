import {
  DIAGRAM_AGENT_TOOL_NAMES,
  SKETCHI_DIAGRAM_AGENT_ID as SHARED_SKETCHI_DIAGRAM_AGENT_ID,
  SKETCHI_DIAGRAM_AGENT_DESCRIPTION,
} from "@sketchi/diagram-agent-tools";

import { appendSketchiDiagramAgentPrompt } from "./agent-hints";

export const SKETCHI_DIAGRAM_AGENT_ID = SHARED_SKETCHI_DIAGRAM_AGENT_ID;

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

  for (const toolID of DIAGRAM_AGENT_TOOL_NAMES) {
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
      SKETCHI_DIAGRAM_AGENT_DESCRIPTION,
    prompt,
    tools: mergeDiagramTools(existingAgent.tools),
  };

  config.agent = agentRegistry;
}
