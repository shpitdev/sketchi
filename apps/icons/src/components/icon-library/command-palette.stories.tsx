import type { Meta, StoryObj } from "@storybook/react-vite";

import { CommandPalette } from "./command-palette";

const fn = () => () => undefined;

const meta = {
	args: {
		collections: new Set(["data-storage"]),
		commands: [
			{ hotkey: "/", id: "search", name: "Search icons", run: fn() },
			{ hotkey: "Mod+A", id: "select-results", name: "Select all 36 results", run: fn() },
			{ id: "copy-selected", name: "Copy 2 selected SVGs", run: fn() },
			{ id: "download-selected", name: "Download 2 selected SVGs as zip", run: fn() },
			{ hotkey: "Mod+D", id: "clear-selection", name: "Clear selection", run: fn() },
			{ id: "preview", name: "Use dark preview", run: fn() },
		],
		links: [
			{ href: "https://sketchi.app/docs", name: "Docs" },
			{ external: true, href: "https://github.com/shpitdev/sketchi", name: "GitHub" },
			{ href: "/llms.txt", name: "llms.txt" },
		],
		onClearCollections: fn(),
		onNavigate: fn(),
		onOpenChange: fn(),
		onToggleCollection: fn(),
		open: true,
		options: [
			["ai-apps-agents", 152],
			["data-storage", 36],
			["devtools-ci", 76],
		],
	},
	component: CommandPalette,
	parameters: { layout: "fullscreen" },
	title: "Icons/Command palette",
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open with one collection active and a two-icon selection. */
export const Open: Story = {};
