import type { Meta, StoryObj } from "@storybook/react-vite";

import { IconDetail } from "./icon-detail";

const meta = {
  args: {
    icon: {
      aliases: ["postgres", "psql"],
      bytes: 1901,
      collection: "data-storage",
      keywords: ["data", "database"],
      name: "PostgreSQL",
      slug: "postgresql",
      svgPath: "/output/upload-ready/svg/data-storage/postgresql.svg",
      viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
    },
    permanentUrl: "https://icons.sketchi.app/api/icons/postgresql.svg",
  },
  component: IconDetail,
  title: "Icons/Icon detail",
} satisfies Meta<typeof IconDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const DarkPreview: Story = { args: { previewMode: "dark" } };
