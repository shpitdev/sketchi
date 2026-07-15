import type { Meta, StoryObj } from "@storybook/react-vite";

import { IconDetail } from "./icon-detail";
import "../../styles/app.css";

const sampleSvg =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='3' y='3' width='18' height='18' rx='5' fill='%231f44c9'/%3E%3Cpath d='M7 12l3 3 5-6' stroke='white' stroke-width='2' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

const meta = {
  title: "Icons/Components/IconDetail",
  component: IconDetail,
  args: {
    icon: {
      bytes: 1901,
      collection: "auth-identity",
      fileName: "workos.svg",
      flags: ["duplicate-raster"],
      id: "auth-identity:workos",
      slug: "workos",
      urlPath: sampleSvg,
      viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
    },
    onClose: () => {},
  },
  tags: ["test"],
} satisfies Meta<typeof IconDetail>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoFlags: Story = {
  args: {
    icon: {
      bytes: 1802,
      collection: "ai-apps-agents",
      fileName: "codex.svg",
      flags: [],
      id: "ai-apps-agents:codex",
      slug: "codex",
      urlPath: sampleSvg,
      viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
    },
  },
};
