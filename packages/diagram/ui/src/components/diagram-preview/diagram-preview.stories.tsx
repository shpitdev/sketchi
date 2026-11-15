// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { Result } from "effect";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { useState } from "react";
import { flowchartFixture, parseFlowchartDiagram } from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import { DiagramPreview } from "./diagram-preview";
import "../../styles.css";

const meta = {
	title: "Diagram UI/Components/DiagramPreview",
	component: DiagramPreview,
	args: {
		scene: renderIntermediateDiagram(flowchartFixture).pipe(Result.getOrThrow),
	},
} satisfies Meta<typeof DiagramPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

const followUpScene = renderIntermediateDiagram(
	parseFlowchartDiagram({
		...flowchartFixture,
		nodes: [...flowchartFixture.nodes, { id: "proof", label: "Verify follow-up", kind: "process" }],
		edges: [
			...flowchartFixture.edges.filter((edge) => edge.id !== "draft-review"),
			{ id: "draft-proof", source: "draft", target: "proof" },
			{ id: "proof-review", source: "proof", target: "review" },
		],
	}).pipe(Result.getOrThrow),
).pipe(Result.getOrThrow);

function RebuildPreview() {
	const [rebuilt, setRebuilt] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setRebuilt((current) => !current)}>
				{rebuilt ? "Restore first build" : "Apply follow-up build"}
			</button>
			<DiagramPreview
				scene={
					rebuilt
						? followUpScene
						: renderIntermediateDiagram(flowchartFixture).pipe(Result.getOrThrow)
				}
			/>
		</>
	);
}

export const SameDiagramRebuild: Story = { render: () => <RebuildPreview /> };
