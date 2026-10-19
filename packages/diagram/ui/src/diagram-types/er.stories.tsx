import type { Meta, StoryObj } from "@storybook/react-vite";

import { erFixture, orgChartEr } from "@sketchi/diagram-core";
import { erScenarios } from "@sketchi/diagram-scenarios";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
	title: "Diagram Types/Er",
	component: GenerationWorkspace,
	args: {
		diagram: erFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

function scenarioDiagram(id: string) {
	const scenario = erScenarios.find((entry) => entry.id === id);
	if (!scenario) throw new Error(`Unknown ER scenario ${id}`);
	return scenario.expectedDiagram;
}

/** Customers, orders, order items and products, each line from key to key. */
export const Ready: Story = {};

/** A self-reference on its own table and optional ends drawn with rings. */
export const SelfReference: Story = {
	args: { diagram: orgChartEr },
};

/** Two tables joined many-to-many through a join table with a composite key. */
export const JoinTable: Story = {
	args: { diagram: scenarioDiagram("course-enrollment-er") },
};

/** Twelve tables in balanced columns, long links through corridors between tables. */
export const LargeSchema: Story = {
	args: { diagram: scenarioDiagram("saas-workspace-er") },
};
