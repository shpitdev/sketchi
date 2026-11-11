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
		origin: "https://icons.sketchi.app",
		packs: [
			{ id: "all", name: "All icons", count: 910, preview },
			{ id: "palantir", name: "Palantir", count: 100, preview },
			{ id: "ai-models", name: "AI labs & models", count: 68, preview },
			{ id: "ai-tools", name: "AI tools & agents", count: 203, preview },
			{ id: "cloud", name: "Cloud", count: 86, preview },
			{ id: "data", name: "Data & backend", count: 63, preview },
			{ id: "devtools", name: "Developer tools", count: 132, preview },
			{ id: "languages", name: "Languages & frameworks", count: 217, preview },
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
