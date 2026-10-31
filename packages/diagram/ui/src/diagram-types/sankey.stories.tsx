import type { Meta, StoryObj } from "@storybook/react-vite";

import { sankeyFixture, sankeyStressFixtures } from "@sketchi/diagram-core";
import { sankeyScenarios } from "@sketchi/diagram-scenarios";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
	title: "Diagram Types/Sankey",
	component: GenerationWorkspace,
	args: {
		diagram: sankeyFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

function scenarioDiagram(id: string) {
	const scenario = sankeyScenarios.find((entry) => entry.id === id);
	if (!scenario) throw new Error(`Unknown Sankey scenario ${id}`);
	return scenario.expectedDiagram;
}

/** Three departments' cloud spend across four services, each band in its department's color. */
export const Ready: Story = {};

/** Flows from 2 to 310: slivers draw at the 3 px floor and keep their exact values beside them. */
export const CloudBudget: Story = {
	args: { diagram: scenarioDiagram("cloud-budget-sankey-v2") },
};

/** Traffic sources through landing pages to outcomes, ordered to cross as few bands as possible. */
export const WebsiteTraffic: Story = {
	args: { diagram: scenarioDiagram("website-traffic-sankey-v2") },
};

/** A hiring funnel whose shared drop-offs line up with the outcomes in the last column. */
export const HiringFunnel: Story = {
	args: { diagram: scenarioDiagram("hiring-funnel-sankey-v2") },
};

/** Five columns; gas imports skip to the sectors through the gaps of the columns between. */
export const CityEnergy: Story = {
	args: { diagram: scenarioDiagram("city-energy-sankey-v2") },
};

/** A funnel with one drop-off per stage, each beside the stage it leaves. */
export const StageDropOffs: Story = {
	args: { diagram: sankeyStressFixtures.stageDropOffs },
};
