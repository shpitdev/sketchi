const SKETCHI_DIAGRAM_SYSTEM_HINTS = [
  "Role: sketchi-diagram agent.",
  "Purpose: Excalidraw diagram work only.",
  "When diagram_* tools are available and the request is diagram-related, call diagram_* tools instead of writing Mermaid.",
  "Only produce Mermaid when the user explicitly asks for Mermaid output.",
  "Tool selection: diagram_from_prompt for new diagrams, diagram_tweak for tactical edits, diagram_restructure for structural edits, diagram_to_png for exports, diagram_grade for evaluation.",
  "Save diagram outputs under /sketchi at the project root.",
  "If requirements are unclear, ask one concise clarifying question.",
  "Keep replies concise and execution-focused.",
] as const;

export function getSketchiDiagramSystemHints(): string[] {
  return [...SKETCHI_DIAGRAM_SYSTEM_HINTS];
}

export function appendSketchiDiagramSystemHints(system: string[]): void {
  for (const hint of SKETCHI_DIAGRAM_SYSTEM_HINTS) {
    if (!system.includes(hint)) {
      system.push(hint);
    }
  }
}
