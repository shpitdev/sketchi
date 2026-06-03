import type { Tree } from "@nx/devkit";
import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";

import { diagramTypeGenerator } from "./diagram-type";
import type { DiagramTypeGeneratorSchema } from "./schema";

describe("diagram-type generator", () => {
  let tree: Tree;
  const options: DiagramTypeGeneratorSchema = {
    description: "Radial knowledge map contract",
    label: "Mind map",
    name: "mindmap",
    prompt: "Show a radial mindmap fixture.",
    title: "Generated mindmap",
    skipFormat: true,
  };

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    tree.write(
      "packages/diagram-core/src/diagram-types.ts",
      `export const DIAGRAM_TYPES = [
  "architecture",
  "flowchart"
] as const;
`
    );
    tree.write(
      "packages/diagram-core/src/fixtures.ts",
      `import { architectureFixture } from "./diagram-types/architecture";
import { flowchartFixture } from "./diagram-types/flowchart";

export const diagramFixtures = {
  "architecture": architectureFixture,
  "flowchart": flowchartFixture,
} as const;
`
    );
    tree.write(
      "packages/diagram-core/src/diagram-catalog.ts",
      `import { architectureFixture } from "./diagram-types/architecture";
import { flowchartFixture } from "./diagram-types/flowchart";
import type { IntermediateDiagram } from "./intermediate";

export interface DiagramCatalogEntry {
  description: string;
  diagram: IntermediateDiagram;
  id: string;
  label: string;
  prompt: string;
}

export const generatedDiagramCatalog = [
  {
    description: "Architecture fixture",
    diagram: architectureFixture,
    id: "architecture",
    label: "Architecture",
    prompt: "Render architecture.",
  },
  {
    description: "Flowchart fixture",
    diagram: flowchartFixture,
    id: "flowchart",
    label: "Flowchart",
    prompt: "Render flowchart.",
  },
] satisfies DiagramCatalogEntry[];
`
    );
    tree.write("packages/diagram-core/src/index.ts", "");
  });

  it("creates diagram fixtures, renderer contract, Storybook story, catalog entry, and registry export", async () => {
    await diagramTypeGenerator(tree, options);

    expect(
      tree.read("packages/diagram-core/src/diagram-types.ts", "utf-8")
    ).toContain('"mindmap"');
    expect(
      tree.read("packages/diagram-core/src/fixtures.ts", "utf-8")
    ).toContain('"mindmap": mindmapFixture');
    const catalog = tree.read(
      "packages/diagram-core/src/diagram-catalog.ts",
      "utf-8"
    );
    expect(catalog).toContain(
      'import { mindmapFixture } from "./diagram-types/mindmap";'
    );
    expect(catalog).toContain('id: "mindmap"');
    expect(catalog).toContain('label: "Mind map"');
    expect(catalog).toContain('description: "Radial knowledge map contract"');
    expect(catalog).toContain('prompt: "Show a radial mindmap fixture."');
    expect(
      tree.exists("packages/diagram-core/src/diagram-types/mindmap.ts")
    ).toBe(true);
    expect(
      tree.exists("packages/diagram-renderer/src/diagram-types/mindmap.test.ts")
    ).toBe(true);
    expect(
      tree.exists(
        "packages/diagram-studio-ui/src/diagram-types/mindmap.stories.tsx"
      )
    ).toBe(true);
    expect(tree.read("packages/diagram-core/src/index.ts", "utf-8")).toContain(
      'export * from "./diagram-types/mindmap";'
    );
  });

  it("does not duplicate a diagram type that is already in the registry", async () => {
    await diagramTypeGenerator(tree, {
      name: "flowchart",
      skipFormat: true,
    });

    const registry = tree.read(
      "packages/diagram-core/src/diagram-types.ts",
      "utf-8"
    );

    expect(registry.match(/"flowchart"/g)).toHaveLength(1);
    expect(
      tree.exists("packages/diagram-core/src/diagram-types/flowchart.ts")
    ).toBe(true);
  });
});
