import type { Meta, StoryObj } from "@storybook/react-vite";

import { SiteHeader } from "./site-header";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/SiteHeader",
  component: SiteHeader,
  args: {
    activePath: "/",
  },
  tags: ["test"],
} satisfies Meta<typeof SiteHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const DocsActive: Story = {
  args: {
    activePath: "/docs",
  },
};
