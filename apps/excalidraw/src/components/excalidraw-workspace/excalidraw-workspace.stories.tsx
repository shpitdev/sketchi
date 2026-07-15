import type { Meta, StoryObj } from "@storybook/react-vite";

import { ExcalidrawWorkspace } from "./excalidraw-workspace";
import "../../styles/app.css";

const meta = {
  title: "Excalidraw/Components/ExcalidrawWorkspace",
  component: ExcalidrawWorkspace,
  args: {
    status: "ready",
  },
  parameters: {
    layout: "fullscreen",
  },
  tags: ["test"],
} satisfies Meta<typeof ExcalidrawWorkspace>;

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
    diagrams: [],
  },
};
