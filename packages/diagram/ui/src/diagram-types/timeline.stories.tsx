import type { Meta, StoryObj } from "@storybook/react-vite";

import { timelineFixture, parseTimelineDiagram } from "@sketchi/diagram-core";
import { timelineScenarios } from "@sketchi/diagram-scenarios";

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

function scenarioDiagram(id: string) {
	const scenario = timelineScenarios.find((entry) => entry.id === id);
	if (!scenario) throw new Error(`Unknown timeline scenario ${id}`);
	return scenario.expectedDiagram;
}

export const Ready: Story = {};

/** Times under one dated, zoned header; milestones as diamonds. */
export const SameDayIncident: Story = {
	args: { diagram: scenarioDiagram("checkout-outage-timeline") },
};

/** Years, months and days keep the precision they were given. */
export const MixedPrecision: Story = {
	args: { diagram: scenarioDiagram("company-history-timeline") },
};

/** A tight cluster fans out; a two-year gap becomes an axis break. */
export const UnevenGaps: Story = {
	args: { diagram: scenarioDiagram("library-releases-timeline") },
};

export const PhasesAndToday: Story = {
	args: { diagram: scenarioDiagram("launch-phases-timeline") },
};

export const Lanes: Story = {
	args: { diagram: scenarioDiagram("launch-workstreams-timeline") },
};

export const DenseMission: Story = {
	args: { diagram: scenarioDiagram("lunar-mission-timeline") },
};

/** Rows read left to right and continue the axis with dashed cues. */
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
