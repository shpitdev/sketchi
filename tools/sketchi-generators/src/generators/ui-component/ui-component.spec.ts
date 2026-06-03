import type { Tree } from "@nx/devkit";
import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import type { UiComponentGeneratorSchema } from "./schema";
import { uiComponentGenerator } from "./ui-component";

describe("ui-component generator", () => {
  let tree: Tree;
  const options: UiComponentGeneratorSchema = {
    name: "Status Badge",
    skipFormat: true,
  };
  const componentRoot =
    "packages/diagram-studio-ui/src/components/status-badge";

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    tree.write("packages/diagram-studio-ui/src/index.ts", "");
  });

  it("creates a component, test, story, and export", async () => {
    await uiComponentGenerator(tree, options);

    expect(tree.exists(`${componentRoot}/status-badge.tsx`)).toBe(true);
    expect(tree.exists(`${componentRoot}/status-badge.test.tsx`)).toBe(true);
    expect(tree.exists(`${componentRoot}/status-badge.stories.tsx`)).toBe(true);
    expect(tree.exists(`${componentRoot}/index.ts`)).toBe(true);
    expect(
      tree.read("packages/diagram-studio-ui/src/index.ts", "utf-8")
    ).toContain('export * from "./components/status-badge";');
  });

  it("creates a testable accessible component contract", async () => {
    await uiComponentGenerator(tree, options);

    const componentSource = tree.read(
      `${componentRoot}/status-badge.tsx`,
      "utf-8"
    );
    const testSource = tree.read(
      `${componentRoot}/status-badge.test.tsx`,
      "utf-8"
    );

    expect(componentSource).toContain("aria-label={title}");
    expect(componentSource).toContain("sketchi-status-badge");
    expect(componentSource).toContain("description?: string");
    expect(componentSource).toContain("title: string");
    expect(testSource).toContain('getByRole("region"');
    expect(testSource).toContain('"Generated component"');
    expect(testSource).toContain("@testing-library/react");
  });

  it("creates a Storybook autodocs story with a default state", async () => {
    await uiComponentGenerator(tree, options);

    const storySource = tree.read(
      `${componentRoot}/status-badge.stories.tsx`,
      "utf-8"
    );

    expect(storySource).toContain(
      'title: "Diagram Studio/Components/StatusBadge"'
    );
    expect(storySource).toContain('tags: ["autodocs"]');
    expect(storySource).toContain("satisfies Meta<typeof StatusBadge>");
    expect(storySource).toContain("export const Default: Story");
    expect(storySource).toContain("export const WithoutDescription: Story");
  });

  it("does not overwrite existing components", async () => {
    await uiComponentGenerator(tree, options);

    await expect(uiComponentGenerator(tree, options)).rejects.toThrow(
      "Component already exists"
    );
  });
});
