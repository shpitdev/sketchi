import type { Meta, StoryObj } from "@storybook/react-vite";

import { HomeHero } from "./home-hero";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/HomeHero",
  component: HomeHero,
  tags: ["test"],
} satisfies Meta<typeof HomeHero>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
