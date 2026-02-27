import { describe, expect, test } from "bun:test";

import {
  appendSketchiDiagramAgentPrompt,
  appendSketchiDiagramSystemHints,
  appendSketchiDiagramSystemPrompt,
  getSketchiDiagramAgentHints,
  shouldInjectSketchiDiagramSystemHints,
} from "./agent-hints";

describe("sketchi-diagram hints", () => {
  test("agent hints include tool routing and Mermaid guardrails", () => {
    const hints = getSketchiDiagramAgentHints().join("\n").toLowerCase();

    expect(hints).toContain("diagram_from_prompt");
    expect(hints).toContain("diagram_tweak");
    expect(hints).toContain("diagram_restructure");
    expect(hints).toContain("diagram_to_png");
    expect(hints).toContain("diagram_grade");
    expect(hints).toContain("instead of writing mermaid");
    expect(hints).toContain("explicitly asks for mermaid");
    expect(hints).toContain("do not run install commands automatically");
    expect(hints).toContain("one diagram_grade call per assistant message");
  });

  test("system hint append does not duplicate hints", () => {
    const system: string[] = [];

    appendSketchiDiagramSystemHints(system);
    appendSketchiDiagramSystemHints(system);

    expect(system.length).toBe(3);
    expect(system.join("\n").toLowerCase()).toContain("subagent");
    expect(system.join("\n").toLowerCase()).toContain("delegate");
  });

  test("agent prompt append merges custom prompt without duplicates", () => {
    const initialPrompt = "Focus on concise answers.";
    const withHints = appendSketchiDiagramAgentPrompt(initialPrompt);
    const withHintsAgain = appendSketchiDiagramAgentPrompt(withHints);

    expect(withHintsAgain).toBe(withHints);
    expect(withHintsAgain).toContain(initialPrompt);
    expect(withHintsAgain.toLowerCase()).toContain(
      "role: sketchi-diagram agent."
    );
    expect(withHintsAgain.toLowerCase()).toContain(
      "instead of writing mermaid"
    );
  });

  test("system prompt append merges custom system prompt without duplicates", () => {
    const initialSystem = "Follow the user's tone.";
    const withHints = appendSketchiDiagramSystemPrompt(initialSystem);
    const withHintsAgain = appendSketchiDiagramSystemPrompt(withHints);

    expect(withHintsAgain).toBe(withHints);
    expect(withHintsAgain).toContain(initialSystem);
    expect(withHintsAgain.toLowerCase()).toContain("sketchi-diagram subagent");
  });

  test("diagram system hints trigger only for configured keywords", () => {
    expect(
      shouldInjectSketchiDiagramSystemHints("please generate a diagram")
    ).toBe(true);
    expect(shouldInjectSketchiDiagramSystemHints("use sketchi tools")).toBe(
      true
    );
    expect(
      shouldInjectSketchiDiagramSystemHints("edit this in excalidraw")
    ).toBe(true);
    expect(shouldInjectSketchiDiagramSystemHints("show git status")).toBe(
      false
    );
  });
});
