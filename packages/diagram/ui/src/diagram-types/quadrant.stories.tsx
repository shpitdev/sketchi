import type { Meta, StoryObj } from "@storybook/react-vite";

import { parseQuadrantDiagram, quadrantFixture } from "@sketchi/diagram-core";
import { quadrantScenarios } from "@sketchi/diagram-scenarios";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
	title: "Diagram Types/Quadrant",
	component: GenerationWorkspace,
	args: {
		diagram: quadrantFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

function scenarioDiagram(id: string) {
	const scenario = quadrantScenarios.find((entry) => entry.id === id);
	if (!scenario) throw new Error(`Unknown quadrant scenario ${id}`);
	return scenario.expectedDiagram;
}

/** Four tinted quadrants with their names in their corners, and a label beside each dot. */
export const Ready: Story = {};

/** Eight items crowded into Quick wins take leader lines; one sits on the effort midline. */
export const CrowdedBacklog: Story = {
	args: { diagram: scenarioDiagram("effort-impact-quadrant") },
};

/** Tasks placed only by quadrant sit well inside it. */
export const EisenhowerMatrix: Story = {
	args: { diagram: scenarioDiagram("eisenhower-matrix-quadrant") },
};

/** One product in a group of its own color, and a quadrant left empty. */
export const CompetitorPositioning: Story = {
	args: { diagram: scenarioDiagram("competitor-positioning-quadrant") },
};

/** Points on the plot's corners, edges and middle lines stay readable. */
export const BoundaryPoints: Story = {
	args: {
		diagram: parseQuadrantDiagram({
			...quadrantFixture,
			id: "boundary-points",
			title: "Points on every edge",
			points: [
				{ label: "Origin", x: 0, y: 0 },
				{ label: "Far corner", x: 1, y: 1 },
				{ label: "Center", x: 0.5, y: 0.5 },
				{ label: "Left edge", x: 0, y: 0.5 },
				{ label: "Top middle", x: 0.5, y: 1 },
				{ label: "On the vertical line", x: 0.5, y: 0.25 },
				{ label: "On the horizontal line", x: 0.8, y: 0.5 },
			],
		}),
	},
};

/** Ten items at one spot stack their labels in columns beside it, each on a leader. */
export const SharedPosition: Story = {
	args: {
		diagram: parseQuadrantDiagram({
			...quadrantFixture,
			id: "shared-position",
			title: "Ten items scored alike",
			points: Array.from({ length: 10 }, (_, index) => ({
				label: `Item ${index + 1}`,
				x: 0.7,
				y: 0.7,
			})),
		}),
	},
};
