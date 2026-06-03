import { architectureFixture, flowchartFixture } from "@sketchi/diagram-core";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DiagramSummaryPanel } from "./diagram-summary-panel";

const meta = {
  title: "Diagram Studio/Components/DiagramSummaryPanel",
  component: DiagramSummaryPanel,
  tags: ["autodocs"],
  args: {
    diagram: architectureFixture,
    prompt: "Show the v2 app, API worker, Convex store, and AI provider.",
    status: "rendered",
  },
} satisfies Meta<typeof DiagramSummaryPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ValidatingFlowchart: Story = {
  args: {
    diagram: flowchartFixture,
    prompt: "Create a left-to-right user onboarding flow.",
    status: "validating",
  },
};
