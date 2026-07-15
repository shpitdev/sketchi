import type { Meta, StoryObj } from "@storybook/react-vite";

import { IconCard } from "./icon-card";
import "../../styles/app.css";

const sampleSvg =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='3' y='3' width='18' height='18' rx='5' fill='%23e5431d'/%3E%3Cpath d='M8 12h8' stroke='white' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E";

const meta = {
  title: "Icons/Components/IconCard",
  component: IconCard,
  args: {
    active: false,
    icon: {
      bytes: 1802,
      collection: "ai-apps-agents",
      fileName: "codex.svg",
      flags: [],
      id: "ai-apps-agents:codex",
      slug: "codex",
      urlPath: sampleSvg,
    },
    onSelect: () => {},
  },
  tags: ["test"],
} satisfies Meta<typeof IconCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Active: Story = {
  args: {
    active: true,
  },
};

export const Flagged: Story = {
  args: {
    icon: {
      bytes: 1901,
      collection: "auth-identity",
      fileName: "workos.svg",
      flags: ["duplicate-raster"],
      id: "auth-identity:workos",
      slug: "workos",
      urlPath: sampleSvg,
    },
  },
};
