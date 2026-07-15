import type { Meta, StoryObj } from "@storybook/react-vite";

import { SiteFooter } from "./site-footer";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/SiteFooter",
  component: SiteFooter,
  tags: ["test"],
} satisfies Meta<typeof SiteFooter>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
