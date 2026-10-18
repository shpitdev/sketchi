import type { Meta, StoryObj } from "@storybook/react-vite";

import { chartFixture, parseChartDiagram } from "@sketchi/diagram-core";
import { chartScenarios } from "@sketchi/diagram-scenarios";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
	title: "Diagram Types/Chart",
	component: GenerationWorkspace,
	args: {
		diagram: chartFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

function scenarioDiagram(id: string) {
	const scenario = chartScenarios.find((entry) => entry.id === id);
	if (!scenario) throw new Error(`Unknown chart scenario ${id}`);
	return scenario.expectedDiagram;
}

/** Grouped columns from a zero baseline, values on their caps, and a legend. */
export const GroupedBars: Story = {};

export const StackedBars: Story = {
	args: { diagram: scenarioDiagram("support-tickets-stacked-bar-chart") },
};

/** Losses hang below the zero baseline. */
export const NegativeBars: Story = {
	args: { diagram: scenarioDiagram("net-income-bar-chart") },
};

/** Category names too long for columns turn the bars horizontal and wrap whole words. */
export const LongCategoryNames: Story = {
	args: { diagram: scenarioDiagram("product-line-revenue-bar-chart") },
};

/** Each series keeps its own marker shape, so the lines read without color. */
export const MultiSeriesLine: Story = {
	args: { diagram: scenarioDiagram("weekly-active-users-line-chart") },
};

export const LineAcrossZero: Story = {
	args: { diagram: scenarioDiagram("temperature-anomaly-line-chart") },
};

/** Thin slices move their labels outside on leader lines that never cross. */
export const PieWithTinySlices: Story = {
	args: { diagram: scenarioDiagram("cloud-spend-pie-chart") },
};

export const Donut: Story = {
	args: { diagram: scenarioDiagram("traffic-sources-donut-chart") },
};

/** Twenty points: category labels thin out rather than overlap. */
export const DenseLine: Story = {
	args: {
		diagram: parseChartDiagram({
			id: "dense-line",
			title: "Monthly active teams",
			type: "chart",
			kind: "line",
			categories: Array.from({ length: 20 }, (_, index) => `Month ${index + 1}`),
			series: [
				{
					name: "Teams",
					values: Array.from({ length: 20 }, (_, index) => 40 + ((index * 37) % 23)),
				},
				{
					name: "Seats",
					values: Array.from({ length: 20 }, (_, index) => 30 + ((index * 17) % 29)),
				},
			],
		}),
	},
};
