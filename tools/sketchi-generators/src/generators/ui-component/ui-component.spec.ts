import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import type { Tree } from "@nx/devkit";

import { uiComponentGenerator } from "./ui-component";
import type { UiComponentGeneratorSchema } from "./schema";

describe("ui-component generator", () => {
  let tree: Tree;
  const options: UiComponentGeneratorSchema = {
    name: "Status Badge",
    skipFormat: true
  };

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    tree.write("packages/diagram-studio-ui/src/index.ts", "");
  });

  it("creates a component, test, story, and export", async () => {
    await uiComponentGenerator(tree, options);

    expect(
      tree.exists(
        "packages/diagram-studio-ui/src/components/status-badge/status-badge.tsx"
      )
    ).toBe(true);
    expect(
      tree.exists(
        "packages/diagram-studio-ui/src/components/status-badge/status-badge.test.tsx"
      )
    ).toBe(true);
    expect(
      tree.exists(
        "packages/diagram-studio-ui/src/components/status-badge/status-badge.stories.tsx"
      )
    ).toBe(true);
    expect(tree.read("packages/diagram-studio-ui/src/index.ts", "utf-8"))
      .toContain('export * from "./components/status-badge/index.js";');
  });
});
