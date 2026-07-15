import type { Meta, StoryObj } from "@storybook/react-vite";

import { FeatureGrid } from "./feature-grid";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/FeatureGrid",
  component: FeatureGrid,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["test"],
} satisfies Meta<typeof FeatureGrid>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
