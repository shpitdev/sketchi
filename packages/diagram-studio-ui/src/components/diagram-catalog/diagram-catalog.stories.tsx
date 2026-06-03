import { architectureFixture, flowchartFixture } from "@sketchi/diagram-core";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DiagramCatalog } from "./diagram-catalog";

const meta = {
  title: "Diagram Studio/Components/DiagramCatalog",
  component: DiagramCatalog,
  args: {
    items: [
      {
        description: "System boundaries",
        diagram: architectureFixture,
        id: "architecture",
        label: "Architecture",
        prompt: "Show the v2 app, API worker, Convex store, and AI provider.",
      },
      {
        description: "User onboarding",
        diagram: flowchartFixture,
        id: "flowchart",
        label: "Flowchart",
        prompt: "Create a left-to-right user onboarding flow.",
      },
    ],
    onSelect: () => undefined,
    selectedId: "architecture",
  },
} satisfies Meta<typeof DiagramCatalog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
