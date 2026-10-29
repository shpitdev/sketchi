import type { Meta, StoryObj } from "@storybook/react-vite";

import { vennFixture, vennStressFixtures } from "@sketchi/diagram-core";
import { vennScenarios } from "@sketchi/diagram-scenarios";

import { GenerationWorkspace } from "../components/generation-workspace/index.js";
import "../styles.css";

const meta = {
	title: "Diagram Types/Venn",
	component: GenerationWorkspace,
	args: {
		diagram: vennFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

function scenarioDiagram(id: string) {
	const scenario = vennScenarios.find((entry) => entry.id === id);
	if (!scenario) throw new Error(`Unknown Venn scenario ${id}`);
	return scenario.expectedDiagram;
}

/** Three sets, every region filled, the centre labeled. */
export const ThreeSets: Story = {};

/** Two sets side by side; the labeled overlap holds what both share. */
export const TwoSets: Story = {
	args: { diagram: vennStressFixtures.twoSets },
};

/** Twenty features, seven in the centre and one region stated empty: the circles grow until every region fits. */
export const DenseCentre: Story = {
	args: { diagram: scenarioDiagram("plan-features-venn") },
};

/** Twelve items in the middle pull the circles together to widen it. */
export const HeavyMiddle: Story = {
	args: { diagram: vennStressFixtures.heavyCenter },
};

/** Long items in each set alone wrap whole words; a dark set color fills with a lighter tint. */
export const LongItemsAndColors: Story = {
	args: { diagram: vennStressFixtures.heavySingles },
};

/** Counts instead of items, under set labels at their 40-character limit. */
export const Counts: Story = {
	args: { diagram: vennStressFixtures.counts },
};

/** Sets alone: the circles keep a readable size. */
export const EmptySets: Story = {
	args: { diagram: vennStressFixtures.empty },
};
