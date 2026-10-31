import type { Meta, StoryObj } from "@storybook/react-vite";

import { ganttFixture, parseGanttDiagram } from "@sketchi/diagram-core";
import { ganttScenarios } from "@sketchi/diagram-scenarios";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
	title: "Diagram Types/Gantt",
	component: GenerationWorkspace,
	args: {
		diagram: ganttFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

function scenarioDiagram(id: string) {
	const scenario = ganttScenarios.find((entry) => entry.id === id);
	if (!scenario) throw new Error(`Unknown Gantt scenario ${id}`);
	return scenario.expectedDiagram;
}

/** Day ticks under a month band, phases, progress, and elbow dependencies into each start. */
export const ReleasePlan: Story = {};

/** Week ticks, milestones, and dependencies routed around the bars between them. */
export const AppRelease: Story = {
	args: { diagram: scenarioDiagram("app-release-gantt-v2") },
};

/** Names indented under phases, with phase spans in the date column, and a Today line. */
export const PhasesAndToday: Story = {
	args: { diagram: scenarioDiagram("cafe-fit-out-gantt-v2") },
};

/** 28 tasks over seven months: month ticks with weekly gridlines, and the axis repeated below. */
export const LongPlan: Story = {
	args: { diagram: scenarioDiagram("data-platform-migration-gantt-v2") },
};

/** A multi-year roadmap reads in quarters, and long names wrap in the name column. */
export const MultiYearRoadmap: Story = {
	args: {
		diagram: parseGanttDiagram({
			id: "platform-roadmap",
			title: "Platform roadmap",
			type: "gantt",
			tasks: [
				{
					id: "research",
					label: "Research and discovery with every regional customer advisory board",
					start: "2026-01-05",
					duration: 45,
				},
				{
					id: "core",
					label: "Core platform",
					start: "2026-03-02",
					end: "2026-12-18",
					dependsOn: ["research"],
				},
				{
					id: "beta",
					label: "Public beta",
					start: "2027-01-11",
					milestone: true,
					dependsOn: ["core"],
				},
				{
					id: "scale",
					label: "Scale-out",
					start: "2027-01-11",
					end: "2027-09-30",
					dependsOn: ["beta"],
					progress: 0,
				},
				{
					id: "ga",
					label: "General availability",
					start: "2027-10-04",
					milestone: true,
					dependsOn: ["scale"],
				},
			],
		}),
	},
};
