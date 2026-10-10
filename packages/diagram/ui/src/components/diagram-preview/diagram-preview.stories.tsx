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
		scene: renderIntermediateDiagram(flowchartFixture),
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
	}),
);

function RebuildPreview() {
	const [rebuilt, setRebuilt] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setRebuilt((current) => !current)}>
				{rebuilt ? "Restore first build" : "Apply follow-up build"}
			</button>
			<DiagramPreview
				scene={rebuilt ? followUpScene : renderIntermediateDiagram(flowchartFixture)}
			/>
		</>
	);
}

export const SameDiagramRebuild: Story = { render: () => <RebuildPreview /> };
