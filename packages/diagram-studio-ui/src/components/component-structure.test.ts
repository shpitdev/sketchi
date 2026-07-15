import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const studioSourceRoot = fileURLToPath(new URL("..", import.meta.url));
const componentsRoot = join(studioSourceRoot, "components");
const packageIndex = readFileSync(join(studioSourceRoot, "index.ts"), "utf-8");

function componentFileExists(componentName: string, suffix: string): boolean {
  return existsSync(
    join(componentsRoot, componentName, `${componentName}${suffix}`),
  );
}

describe("Studio component structure", () => {
  it("keeps reusable components generated, tested, story-backed, and exported", () => {
    const componentNames = readdirSync(componentsRoot, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(componentNames.length).toBeGreaterThan(0);

    for (const componentName of componentNames) {
      expect(componentFileExists(componentName, ".tsx")).toBe(true);
      expect(componentFileExists(componentName, ".test.tsx")).toBe(true);
      expect(componentFileExists(componentName, ".stories.tsx")).toBe(true);
      expect(existsSync(join(componentsRoot, componentName, "index.ts"))).toBe(
        true,
      );
      expect(packageIndex).toContain(
        `export * from "./components/${componentName}/index.js";`,
      );
    }
  });
});
