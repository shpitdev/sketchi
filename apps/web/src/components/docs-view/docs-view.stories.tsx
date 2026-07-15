import type { Meta, StoryObj } from "@storybook/react-vite";

import { DocsView } from "./docs-view";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/DocsView",
  component: DocsView,
  tags: ["test"],
} satisfies Meta<typeof DocsView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
