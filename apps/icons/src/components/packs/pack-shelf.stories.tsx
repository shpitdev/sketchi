import type { Meta, StoryObj } from "@storybook/react-vite";

import type { PackIcon } from "../../lib/packs";
import { PackShelf } from "./pack-shelf";

const shapes: PackIcon[] = [
	{
		slug: "ring",
		name: "Ring",
		recipe: { parts: [{ kind: "ellipse", cx: 12, cy: 12, rx: 8, ry: 8, fill: "#4c6ef5" }] },
	},
	{
		slug: "box",
		name: "Box",
		recipe: { parts: [{ kind: "rect", x: 4, y: 4, width: 16, height: 16, rounded: true }] },
	},
	{
		slug: "flow",
		name: "Flow",
		recipe: {
			parts: [
				{
					kind: "arrow",
					points: [
						[4, 18],
						[12, 6],
						[20, 18],
					],
				},
			],
		},
	},
];

const preview = [...shapes, ...shapes];

const meta = {
	args: {
		packs: [
			{ id: "all", name: "All icons", version: "0123456789abcdef", count: 910, preview },
			{ id: "palantir", name: "Palantir", version: "0123456789abcdef", count: 100, preview },
			{
				id: "ai-models",
				name: "AI labs & models",
				version: "0123456789abcdef",
				count: 68,
				preview,
			},
			{
				id: "ai-tools",
				name: "AI tools & agents",
				version: "0123456789abcdef",
				count: 203,
				preview,
			},
			{ id: "cloud", name: "Cloud", version: "0123456789abcdef", count: 86, preview },
			{ id: "data", name: "Data & backend", version: "0123456789abcdef", count: 63, preview },
			{ id: "devtools", name: "Developer tools", version: "0123456789abcdef", count: 132, preview },
			{
				id: "languages",
				name: "Languages & frameworks",
				version: "0123456789abcdef",
				count: 217,
				preview,
			},
		],
		previewMode: "light",
	},
	component: PackShelf,
	title: "Icons/Pack shelf",
} satisfies Meta<typeof PackShelf>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { args: { previewMode: "dark" } };

/** A submitted pack adds to Excalidraw; one still open offers to publish. */
export const OnExcalidraw: Story = {
	args: {
		excalidraw: {
			palantir: {
				installUrl:
					"https://excalidraw.com/?addLibrary=https%3A%2F%2Fraw.githubusercontent.com%2Fexcalidraw%2Fexcalidraw-libraries%2Fjane-palantir-platform-icons-1%2Flibraries%2Fjane%2Fpalantir-platform-icons.excalidrawlib%3Fraw%3Dtrue",
				publishable: false,
			},
			cloud: { publishable: true },
		},
	},
};
