import { architectureFixture, flowchartFixture } from "@sketchi/diagram-core";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { GenerationWorkspace } from "./generation-workspace";

const meta = {
  title: "Diagram Studio/Components/GenerationWorkspace",
  component: GenerationWorkspace,
  tags: ["autodocs"],
  args: {
    diagrams: [
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
    selectedDiagramId: "architecture",
    status: "rendered",
  },
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
