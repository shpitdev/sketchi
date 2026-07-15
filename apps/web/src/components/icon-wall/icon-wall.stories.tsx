import type { Meta, StoryObj } from "@storybook/react-vite";

import { IconWall } from "./icon-wall";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/IconWall",
  component: IconWall,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["test"],
} satisfies Meta<typeof IconWall>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
