import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentsRoot = join(process.cwd(), "src", "components");
const packageIndexPath = join(process.cwd(), "src", "index.ts");

function toPascalCase(value: string) {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function listComponentDirectories() {
  return readdirSync(componentsRoot)
    .filter((entry) => statSync(join(componentsRoot, entry)).isDirectory())
    .sort();
}

describe("diagram studio component package structure", () => {
  it("keeps each component as a tested, storied, exported package unit", () => {
    const packageIndex = readFileSync(packageIndexPath, "utf-8");

    for (const componentName of listComponentDirectories()) {
      const componentRoot = join(componentsRoot, componentName);
      const componentClassName = toPascalCase(componentName);
      const componentIndex = readFileSync(
        join(componentRoot, "index.ts"),
        "utf-8"
      );
      const componentStory = readFileSync(
        join(componentRoot, `${componentName}.stories.tsx`),
        "utf-8"
      );
      const componentTest = readFileSync(
        join(componentRoot, `${componentName}.test.tsx`),
        "utf-8"
      );

      expect(existsSync(join(componentRoot, `${componentName}.tsx`))).toBe(
        true
      );
      expect(existsSync(join(componentRoot, `${componentName}.test.tsx`))).toBe(
        true
      );
      expect(
        existsSync(join(componentRoot, `${componentName}.stories.tsx`))
      ).toBe(true);
      expect(componentIndex).toContain(`export * from "./${componentName}";`);
      expect(packageIndex).toContain(
        `export * from "./components/${componentName}";`
      );
      expect(componentStory).toContain(
        `title: "Diagram Studio/Components/${componentClassName}"`
      );
      expect(componentStory).toContain(`component: ${componentClassName}`);
      expect(componentStory).toContain('tags: ["autodocs"]');
      expect(componentStory).toContain(
        `satisfies Meta<typeof ${componentClassName}>`
      );
      expect(componentStory).toContain("export const Default: Story");
      expect(componentTest).toContain("@testing-library/react");
      expect(componentTest).toContain(`describe("${componentClassName}"`);
    }
  });
});
