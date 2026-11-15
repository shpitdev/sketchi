import type { Meta, StoryObj } from "@storybook/react-vite";

import { IconCard } from "./icon-card";

const meta = {
	args: {
		icon: {
			aliases: ["k8s"],
			bytes: 2489,
			collection: "devtools-ci",
			colorMode: "multicolor",
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
export const DarkInvertsNeutralMark: Story = {
	args: {
		icon: {
			aliases: [],
			bytes: 1700,
			collection: "cloud-hosting-paas",
			colorMode: "mono-dark",
			keywords: ["hosting"],
			name: "Vercel",
			onDark: "invert",
			slug: "vercel",
			svgPath: "/output/upload-ready/svg/cloud-hosting-paas/vercel.svg",
			viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
		},
		previewMode: "dark",
	},
};
export const DarkPlatesMulticolorMark: Story = {
	args: {
		icon: {
			aliases: ["amazon"],
			bytes: 2900,
			collection: "cloud-vendors",
			colorMode: "multicolor",
			keywords: ["aws"],
			name: "AWS",
			onDark: "plate",
			slug: "aws",
			svgPath: "/output/upload-ready/svg/cloud-vendors/aws.svg",
			viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
		},
		previewMode: "dark",
	},
};
