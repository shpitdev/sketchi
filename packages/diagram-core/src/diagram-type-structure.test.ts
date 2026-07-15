import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DIAGRAM_TYPES } from "./diagram-types";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const coreDiagramTypeRoot = join(
  workspaceRoot,
  "packages/diagram-core/src/diagram-types",
);

function exists(path: string): boolean {
  return existsSync(join(workspaceRoot, path));
}

describe("diagram type structure", () => {
  it("keeps the registry backed by generated core, renderer, and Storybook files", () => {
    for (const type of DIAGRAM_TYPES) {
      expect(
        exists(`packages/diagram-core/src/diagram-types/${type}.ts`),
      ).toBe(true);
      expect(
        exists(`packages/diagram-core/src/diagram-types/${type}.test.ts`),
      ).toBe(true);
      expect(
        exists(`packages/diagram-renderer/src/diagram-types/${type}.test.ts`),
      ).toBe(true);
      expect(
        exists(`packages/diagram-studio-ui/src/diagram-types/${type}.stories.tsx`),
      ).toBe(true);
    }
  });

  it("does not leave unregistered diagram type modules behind", () => {
    const registered = new Set(DIAGRAM_TYPES);
    const typeModules = readdirSync(coreDiagramTypeRoot)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => !file.endsWith(".test.ts"))
      .map((file) => file.replace(/\.ts$/u, ""));

    expect(typeModules.sort()).toEqual([...registered].sort());
  });
});
