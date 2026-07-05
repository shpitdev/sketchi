import type { Meta, StoryObj } from "@storybook/react-vite";

import { AgentStrip } from "./agent-strip";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/AgentStrip",
  component: AgentStrip,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["test"],
} satisfies Meta<typeof AgentStrip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
