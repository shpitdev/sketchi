import type { Meta, StoryObj } from "@storybook/react-vite";

import { CommandBlock } from "./command-block";
import "../../styles/app.css";

const meta = {
	title: "Web/Components/CommandBlock",
	component: CommandBlock,
	tags: ["test"],
} satisfies Meta<typeof CommandBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Command: Story = {
	args: {
		label: "install command",
		value: "codex plugin marketplace add shpitdev/sketchi",
	},
};

export const Continued: Story = {
	args: {
		label: "connect command",
		value: "opencode mcp add sketchi-code-mode \\\n  --url https://playground.sketchi.app/mcp",
	},
};

export const Prompt: Story = {
	args: {
		kind: "prose",
		label: "first prompt",
		value:
			"$sketchi-code-mode Create a top-to-bottom request approval flowchart and return the hosted Excalidraw and PNG artifacts.",
	},
};
