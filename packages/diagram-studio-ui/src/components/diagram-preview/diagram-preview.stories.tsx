import { architectureFixture, flowchartFixture } from "@sketchi/diagram-core";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DiagramPreview } from "./diagram-preview";

const meta = {
  title: "Diagram Studio/Components/DiagramPreview",
  component: DiagramPreview,
  tags: ["autodocs"],
  args: {
    diagram: architectureFixture,
  },
} satisfies Meta<typeof DiagramPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Flowchart: Story = {
  args: {
    diagram: flowchartFixture,
  },
};
