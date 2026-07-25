import type { Meta, StoryObj } from "@storybook/react-vite";

import { CliBand } from "./cli-band";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/CliBand",
  component: CliBand,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["test"],
} satisfies Meta<typeof CliBand>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Narrow viewport: the copy and the terminal card stack. */
export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};
