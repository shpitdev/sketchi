import { architectureFixture } from "@sketchi/diagram-core";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
  component: GenerationWorkspace,
  title: "Diagram Types/Architecture",
  args: {
    diagrams: [
      {
        description: "Generated architecture fixture",
        diagram: architectureFixture,
        id: "architecture",
        label: "Architecture",
        prompt: "Render the generated architecture fixture.",
      },
    ],
    selectedDiagramId: "architecture",
    status: "rendered",
  },
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Rendered: Story = {};
