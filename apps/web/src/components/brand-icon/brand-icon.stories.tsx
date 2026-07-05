import type { Meta, StoryObj } from "@storybook/react-vite";

import { BrandIcon } from "./brand-icon";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/BrandIcon",
  component: BrandIcon,
  args: {
    label: "Cloudflare",
    src: "/brand/cloudflare.svg",
    size: 40,
  },
  tags: ["test"],
} satisfies Meta<typeof BrandIcon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Plain: Story = {};

export const Tile: Story = {
  args: {
    tile: true,
  },
};
