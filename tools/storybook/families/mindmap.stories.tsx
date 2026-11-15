// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { Result } from "effect";
import { type Meta, type StoryObj } from "@storybook/react-vite";

import { type MindmapTopic, parseMindmap } from "@sketchi/diagrams/families/mindmap/index";
import { mindmapFixture } from "@sketchi/diagrams/families/mindmap/fixtures";
import { mindmapScenarios } from "@sketchi/diagram-scenarios";

import { GenerationWorkspace } from "../../../apps/playground/src/features/generation-workspace/index.js";

const meta = {
	title: "Diagram Types/Mindmap",
	component: GenerationWorkspace,
	args: {
		diagram: mindmapFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

function scenarioDiagram(id: string) {
	const scenario = mindmapScenarios.find((entry) => entry.id === id);
	if (!scenario) throw new Error(`Unknown mindmap scenario ${id}`);
	return scenario.expectedDiagram;
}

function map(title: string, root: MindmapTopic) {
	return parseMindmap({ id: title.toLowerCase().replaceAll(" ", "-"), title, root }).pipe(
		Result.getOrThrow,
	);
}

/** Two branches staggered around the central topic. */
export const Ready: Story = {};

/** A small brainstorm: four branches, two a side, clockwise from the top right. */
export const Brainstorm: Story = {
	args: { diagram: scenarioDiagram("team-offsite-mindmap-v2") },
};

/** Study notes three levels deep. */
export const StudyNotes: Story = {
	args: { diagram: scenarioDiagram("photosynthesis-study-mindmap-v2") },
};

/** Seven main branches spread on an arc around the center. */
export const ProductPlan: Story = {
	args: { diagram: scenarioDiagram("app-launch-planning-mindmap-v2") },
};

/** 41 topics, three levels. */
export const LargeRoadmap: Story = {
	args: { diagram: scenarioDiagram("ml-roadmap-mindmap-v2") },
};

/** 42 topics five levels deep under two uneven branches. */
export const DeepClassification: Story = {
	args: { diagram: scenarioDiagram("animal-kingdom-mindmap-v2") },
};

/** The same brainstorm mirrored: counter-clockwise from the top left. */
export const RightToLeft: Story = {
	args: {
		diagram: {
			...scenarioDiagram("team-offsite-mindmap-v2"),
			layout: { direction: "RL" },
		},
	},
};

/** Two dozen lone topics fan out from the center like spokes. */
export const ManyBranches: Story = {
	args: {
		diagram: map("Flat list", {
			label: "Topics",
			children: Array.from({ length: 24 }, (_, index) => ({ label: `Item number ${index + 1}` })),
		}),
	},
};

/** A chain too deep for one row folds into a list below its topics. */
export const DeepChain: Story = {
	args: {
		diagram: map("Deep chain", {
			label: "Root idea",
			children: [
				["First", "Second", "Third", "Fourth", "Fifth", "Sixth"].reduceRight<MindmapTopic>(
					(child, label) => ({ label: `${label} step`, children: [child] }),
					{ label: "Seventh step" },
				),
			],
		}),
	},
};

/** Long labels wrap to balanced lines; the central topic's ellipse grows to hold its own. */
export const LongLabels: Story = {
	args: {
		diagram: map("Long labels", {
			label: "A central topic with a rather long descriptive label",
			children: [
				{
					label: "A main branch whose label runs on for several words",
					children: [
						{ label: "A detail with an unusually verbose explanation attached to it" },
						{ label: "Short" },
					],
				},
				{
					label: "Second",
					children: [
						{ label: "Another fairly long subtopic label that needs wrapping" },
						{ label: "Tiny" },
					],
				},
				{ label: "Third" },
			],
		}),
	},
};
