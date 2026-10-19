import type { Meta, StoryObj } from "@storybook/react-vite";

import { orgChartFixture, orgChartStressFixtures } from "@sketchi/diagram-core";
import { orgChartScenarios } from "@sketchi/diagram-scenarios";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
	title: "Diagram Types/Org Chart",
	component: GenerationWorkspace,
	args: {
		diagram: orgChartFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

function scenarioDiagram(id: string) {
	const scenario = orgChartScenarios.find((entry) => entry.id === id);
	if (!scenario) throw new Error(`Unknown org chart scenario ${id}`);
	return scenario.expectedDiagram;
}

/** A CEO with an assistant beside her, two leads and their reports, and a dotted-line report. */
export const Ready: Story = {};

/** Twelve people: three leads under the CEO, each team stacked under its lead. */
export const Startup: Story = {
	args: { diagram: scenarioDiagram("startup-team-org-chart") },
};

/** Twenty-five people over three levels; a director's eight engineers stack in two columns. */
export const Department: Story = {
	args: { diagram: scenarioDiagram("engineering-department-org-chart") },
};

/** An executive assistant beside the CEO and a director's dotted-line report to another chief. */
export const AssistantAndDottedLine: Story = {
	args: { diagram: scenarioDiagram("leadership-dotted-line-org-chart") },
};

/** Each department below the top drawn as a labeled region. */
export const DepartmentRegions: Story = {
	args: { diagram: scenarioDiagram("sales-regions-org-chart") },
};

/** Eighty people: the CEO's six vice presidents wrap into rows down a trunk. */
export const EightyPeople: Story = {
	args: { diagram: orgChartStressFixtures.eighty },
};
