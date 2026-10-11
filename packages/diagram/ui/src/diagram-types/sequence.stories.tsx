import type { Meta, StoryObj } from "@storybook/react-vite";

import { apiRequestSequence, sequenceFixture } from "@sketchi/diagram-core";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
	title: "Diagram Types/Sequence",
	component: GenerationWorkspace,
	args: {
		diagram: sequenceFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const ApiRequestWithCacheMiss: Story = {
	args: {
		diagram: apiRequestSequence,
	},
};
