import type { Meta, StoryObj } from "@storybook/react-vite";

import { mindmapFixture } from "@sketchi/diagram-core";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
  title: "Diagram Types/Mindmap",
  component: GenerationWorkspace,
  args: {
    diagram: mindmapFixture,
    status: "ready"
  }
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
