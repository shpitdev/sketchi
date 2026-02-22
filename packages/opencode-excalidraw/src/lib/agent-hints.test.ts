import { describe, expect, test } from "bun:test";

import {
  appendSketchiDiagramSystemHints,
  getSketchiDiagramSystemHints,
} from "./agent-hints";

describe("sketchi-diagram system hints", () => {
  test("includes tool routing and Mermaid guardrails", () => {
    const hints = getSketchiDiagramSystemHints().join("\n").toLowerCase();

    expect(hints).toContain("diagram_from_prompt");
    expect(hints).toContain("diagram_tweak");
    expect(hints).toContain("diagram_restructure");
    expect(hints).toContain("diagram_to_png");
    expect(hints).toContain("diagram_grade");
    expect(hints).toContain("instead of writing mermaid");
    expect(hints).toContain("explicitly asks for mermaid");
  });

  test("append does not duplicate hints", () => {
    const system: string[] = [];

    appendSketchiDiagramSystemHints(system);
    appendSketchiDiagramSystemHints(system);

    expect(system.length).toBe(getSketchiDiagramSystemHints().length);
  });
});
