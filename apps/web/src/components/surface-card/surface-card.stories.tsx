import type { Meta, StoryObj } from "@storybook/react-vite";

import { SurfaceCard } from "./surface-card";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/SurfaceCard",
  component: SurfaceCard,
  args: {
    cta: "Open Playground",
    desc: "Anonymous prompt-to-diagram generation with artifact handoff.",
    domain: "playground.sketchi.app",
    href: "https://playground.sketchi.app",
    name: "Sketchi Playground",
    status: "preview",
  },
  tags: ["test"],
} satisfies Meta<typeof SurfaceCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Live: Story = {
  args: {
    cta: "Open docs",
    desc: "How the pipeline, diagram types, auth status, and deploys fit together.",
    domain: "sketchi.app/docs",
    href: "/docs",
    name: "Documentation",
    status: "live",
  },
};
