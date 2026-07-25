import type { Meta, StoryObj } from "@storybook/react-vite";

import type { IconManifest } from "../../lib/icon-data";
import { IconLibrary } from "./icon-library";

const data: IconManifest = {
  icons: [
    {
      aliases: ["k8s"],
      bytes: 2489,
      collection: "devtools-ci",
      keywords: ["containers"],
      name: "Kubernetes",
      slug: "kubernetes",
      svgPath: "/output/upload-ready/svg/devtools-ci/kubernetes.svg",
      viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
    },
    {
      aliases: ["next", "next.js"],
      bytes: 960,
      collection: "frontend-frameworks",
      keywords: ["react", "framework"],
      name: "Next.js",
      slug: "nextjs",
      svgPath: "/output/upload-ready/svg/frontend-frameworks/nextjs.svg",
      viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
    },
    {
      aliases: ["postgres", "psql"],
      bytes: 1901,
      collection: "data-storage",
      keywords: ["database"],
      name: "PostgreSQL",
      slug: "postgresql",
      svgPath: "/output/upload-ready/svg/data-storage/postgresql.svg",
      viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
    },
    {
      aliases: [],
      bytes: 1700,
      collection: "cloud-hosting-paas",
      keywords: ["hosting"],
      name: "Vercel",
      slug: "vercel",
      svgPath: "/output/upload-ready/svg/cloud-hosting-paas/vercel.svg",
      viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
    },
  ],
  summary: {
    collectionCounts: {
      "cloud-hosting-paas": 1,
      "data-storage": 1,
      "devtools-ci": 1,
      "frontend-frameworks": 1,
    },
    totalIcons: 4,
  },
  version: 1,
};

const meta = {
  args: { data },
  component: IconLibrary,
  parameters: { layout: "fullscreen" },
  title: "Icons/Product library",
} satisfies Meta<typeof IconLibrary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const Loading: Story = { args: { status: "loading" } };
export const ErrorState: Story = {
  args: { errorMessage: "The library could not be loaded.", status: "error" },
};
