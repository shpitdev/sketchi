import type { Meta, StoryObj } from "@storybook/react-vite";

import { MarketingHome } from "./marketing-home";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/MarketingHome",
  component: MarketingHome,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["test"],
} satisfies Meta<typeof MarketingHome>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
