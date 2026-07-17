import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  flowchartFixture,
  pharmaBatchDispositionFlowchart
} from "@sketchi/diagram-core";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
  title: "Diagram Types/Flowchart",
  component: GenerationWorkspace,
  args: {
    diagram: flowchartFixture,
    status: "ready",
  },
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const PharmaBatchDisposition: Story = {
  args: {
    diagram: pharmaBatchDispositionFlowchart
  }
};
