import type { Meta, StoryObj } from "@storybook/react-vite";

import { WorkspaceTopBar } from "./workspace-top-bar";
import "../../styles/app.css";

const meta = {
  title: "Excalidraw/Components/WorkspaceTopBar",
  component: WorkspaceTopBar,
  args: {
    diagramType: "flowchart",
    status: "ready",
    title: "Pharma batch disposition flow",
  },
  tags: ["test"],
} satisfies Meta<typeof WorkspaceTopBar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Generating: Story = {
  args: {
    status: "loading",
  },
};

export const Empty: Story = {
  args: {
    diagramType: undefined,
    status: "empty",
    title: "No diagram",
  },
};
