import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { loadPromptLibrary } from "../lib/prompts/loader";

const libraryDir = fileURLToPath(
  new URL("../lib/prompts/library", import.meta.url)
);

describe("prompt library", () => {
  test("loads without errors or warnings", () => {
    const result = loadPromptLibrary(libraryDir);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.prompts.length).toBeGreaterThan(0);
    expect(result.resolvedPrompts.length).toBe(result.prompts.length);
  });
});
