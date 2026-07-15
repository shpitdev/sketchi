import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  acceptedFlowchartBuild,
  decisionLoopFlowchartBuild,
  denseFlowchartBuild,
  rejectedFlowchartBuild,
} from "./flowchart-build-report.fixtures";
import { FlowchartBuildReport } from "./flowchart-build-report";

const meta = {
  title: "Diagram Studio/Components/FlowchartBuildReport",
  component: FlowchartBuildReport,
  args: {
    attempt: 1,
    result: acceptedFlowchartBuild,
  },
} satisfies Meta<typeof FlowchartBuildReport>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Accepted: Story = {};

export const RejectedRepair: Story = {
  args: { attempt: 2, result: rejectedFlowchartBuild },
};

export const Dense: Story = {
  args: { result: denseFlowchartBuild },
};

export const DecisionLoop: Story = {
  args: { result: decisionLoopFlowchartBuild },
};
