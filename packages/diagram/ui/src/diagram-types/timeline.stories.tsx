import type { Meta, StoryObj } from "@storybook/react-vite";

import { timelineFixture, parseTimelineDiagram } from "@sketchi/diagram-core";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
	title: "Diagram Types/Timeline",
	component: GenerationWorkspace,
	args: {
		diagram: timelineFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const LongChronology: Story = {
	args: {
		diagram: parseTimelineDiagram({
			...timelineFixture,
			events: Array.from({ length: 24 }, (_, index) => ({
				id: `phase-${index}`,
				label: `Project milestone ${index + 1}`,
				order: index,
				description: "A concise milestone description.",
			})),
		}),
	},
};
