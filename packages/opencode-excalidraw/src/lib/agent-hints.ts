const SKETCHI_DIAGRAM_AGENT_HINTS = [
  "Role: sketchi-diagram agent.",
  "Purpose: Excalidraw diagram work only.",
  "When diagram_* tools are available and the request is diagram-related, call diagram_* tools instead of writing Mermaid.",
  "Only produce Mermaid when the user explicitly asks for Mermaid output.",
  "Tool selection: diagram_from_prompt for new diagrams, diagram_tweak for tactical edits, diagram_restructure for structural edits, diagram_to_png for exports, diagram_grade for evaluation.",
  "Save diagram outputs under /sketchi at the project root.",
  "If requirements are unclear, ask one concise clarifying question.",
  "Keep replies concise and execution-focused.",
] as const;

const SKETCHI_DIAGRAM_SYSTEM_HINTS = [
  "A sketchi-diagram subagent is available for Excalidraw diagram work.",
  "For diagram requests, delegate to sketchi-diagram and diagram_* tools instead of writing Mermaid.",
  "Only produce Mermaid when the user explicitly asks for Mermaid output.",
] as const;

const DIAGRAM_REQUEST_PATTERN = /\b(diagram|sketchi|excalidraw)\b/iu;
const NEWLINE_PATTERN = /\r?\n/u;

function appendUniqueLines(lines: string[], hints: readonly string[]): void {
  for (const hint of hints) {
    if (!lines.includes(hint)) {
      lines.push(hint);
    }
  }
}

function splitLines(input: string): string[] {
  return input
    .split(NEWLINE_PATTERN)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function getSketchiDiagramAgentHints(): string[] {
  return [...SKETCHI_DIAGRAM_AGENT_HINTS];
}

export function appendSketchiDiagramAgentPrompt(prompt?: string): string {
  const lines = prompt ? splitLines(prompt) : [];
  appendUniqueLines(lines, SKETCHI_DIAGRAM_AGENT_HINTS);
  return lines.join("\n");
}

export function getSketchiDiagramSystemHints(): string[] {
  return [...SKETCHI_DIAGRAM_SYSTEM_HINTS];
}

export function appendSketchiDiagramSystemHints(system: string[]): void {
  appendUniqueLines(system, SKETCHI_DIAGRAM_SYSTEM_HINTS);
}

export function appendSketchiDiagramSystemPrompt(system?: string): string {
  const lines = system ? splitLines(system) : [];
  appendUniqueLines(lines, SKETCHI_DIAGRAM_SYSTEM_HINTS);
  return lines.join("\n");
}

export function shouldInjectSketchiDiagramSystemHints(text: string): boolean {
  return DIAGRAM_REQUEST_PATTERN.test(text);
}
