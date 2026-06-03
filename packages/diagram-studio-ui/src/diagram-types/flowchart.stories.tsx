import { flowchartFixture } from "@sketchi/diagram-core";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
  component: GenerationWorkspace,
  title: "Diagram Types/Flowchart",
  args: {
    diagrams: [
      {
        description: "Generated flowchart fixture",
        diagram: flowchartFixture,
        id: "flowchart",
        label: "Flowchart",
        prompt: "Render the generated flowchart fixture.",
      },
    ],
    selectedDiagramId: "flowchart",
    status: "rendered",
  },
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Rendered: Story = {};
