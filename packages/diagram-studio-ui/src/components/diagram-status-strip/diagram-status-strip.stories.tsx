import type { Meta, StoryObj } from "@storybook/react-vite";

import { DiagramStatusStrip } from "./diagram-status-strip";

const meta = {
  title: "Diagram Studio/Components/DiagramStatusStrip",
  component: DiagramStatusStrip,
  tags: ["autodocs"],
  args: {
    edgeCount: 3,
    nodeCount: 4,
    status: "rendered",
  },
} satisfies Meta<typeof DiagramStatusStrip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Validating: Story = {
  args: {
    status: "validating",
  },
};

export const ErrorState: Story = {
  args: {
    status: "error",
  },
};
