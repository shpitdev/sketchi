import type { Meta, StoryObj } from "@storybook/react-vite";

import { FlowchartValidationPanel } from "./flowchart-validation-panel";

const meta = {
  title: "Diagram Studio/Components/FlowchartValidationPanel",
  component: FlowchartValidationPanel,
  args: {
    nodeCount: 7,
    edgeCount: 7,
    intermediateMessage: "Validated flowchart IR",
    realSceneIssueCount: 0,
    realSceneMessage: "All arrows are bound"
  }
} satisfies Meta<typeof FlowchartValidationPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Valid: Story = {};

export const RealSceneIssues: Story = {
  args: {
    realSceneIssueCount: 2,
    realSceneMessage: "2 real-scene issues"
  }
};
