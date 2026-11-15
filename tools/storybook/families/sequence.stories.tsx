import {
	apiRequestSequence,
	selfMessageSequence,
} from "@sketchi/diagrams/families/sequence/fixtures";
import { familyForType } from "@sketchi/diagrams/family";
import { type Meta, type StoryObj } from "@storybook/react-vite";

import { GenerationWorkspace } from "../../../apps/playground/src/features/generation-workspace/index.js";

const sequenceFixture = familyForType("sequence").fixture;

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

export const SelfMessages: Story = {
	args: {
		diagram: selfMessageSequence,
	},
};
