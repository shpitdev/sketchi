import type { Meta, StoryObj } from "@storybook/react-vite";

import { IconCard } from "./icon-card";

const meta = {
  args: {
    icon: {
      aliases: ["k8s"],
      bytes: 2489,
      collection: "devtools-ci",
      keywords: ["containers", "orchestration"],
      name: "Kubernetes",
      slug: "kubernetes",
      svgPath: "/output/upload-ready/svg/devtools-ci/kubernetes.svg",
      viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
    },
  },
  component: IconCard,
  title: "Icons/Icon card",
} satisfies Meta<typeof IconCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const SelectedDark: Story = {
  args: { previewMode: "dark", selected: true },
};
