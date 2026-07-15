import type { Meta, StoryObj } from "@storybook/react-vite";

import { CtaBand } from "./cta-band";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/CtaBand",
  component: CtaBand,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["test"],
} satisfies Meta<typeof CtaBand>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
