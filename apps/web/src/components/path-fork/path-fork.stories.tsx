import type { Meta, StoryObj } from "@storybook/react-vite";

import { PathFork } from "./path-fork";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/PathFork",
  component: PathFork,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["test"],
} satisfies Meta<typeof PathFork>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
