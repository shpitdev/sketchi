import { useMemo } from "react";

import { type CanonicalDiagram, validateCanonicalDiagram } from "@sketchi/diagram-core";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import { renderDiagram } from "@sketchi/diagram-renderer";

import { DiagramPreview } from "../diagram-preview/index.js";
import { FlowchartValidationPanel } from "../flowchart-validation-panel/index.js";

export interface GenerationWorkspaceProps {
	diagram: CanonicalDiagram;
	status?: "idle" | "generating" | "ready" | "error";
}

const statusLabels = {
	idle: "Idle",
	generating: "Generating",
	ready: "Ready",
	error: "Needs attention",
};

function diagramCounts(diagram: CanonicalDiagram) {
	return diagram.type === "sequence"
		? {
				nodeCount: diagram.participants.length,
				nodeNoun: "participants",
				edgeCount: diagram.messages.length,
				edgeNoun: "messages",
			}
		: { nodeCount: diagram.nodes.length, edgeCount: diagram.edges.length };
}

export function GenerationWorkspace({ diagram, status = "ready" }: GenerationWorkspaceProps) {
	const { validationMessage, scene, realSceneIssueCount, realSceneMessage } = useMemo(() => {
		let validationMessage = `Validated ${diagram.type} IR`;

		try {
			validateCanonicalDiagram(diagram);
		} catch (error) {
			validationMessage = error instanceof Error ? error.message : "Diagram validation failed";
		}

		const scene = renderDiagram(diagram);
		const realSceneValidation = validateExcalidrawScene(convertSceneToExcalidraw(scene));
		const realSceneIssueCount = realSceneValidation.issues.length;
		const realSceneMessage =
			realSceneIssueCount === 0
				? "All arrows are bound"
				: `${realSceneIssueCount} real-scene issues`;
		return {
			validationMessage,
			scene,
			realSceneIssueCount,
			realSceneMessage,
		};
	}, [diagram]);

	return (
		<section className="sketchi-generation-workspace">
			<header className="sketchi-generation-workspace__header">
				<div>
					<p className="sketchi-generation-workspace__eyebrow">Sketchi v2</p>
					<h1>{diagram.title}</h1>
				</div>
				<span className="sketchi-generation-workspace__status">{statusLabels[status]}</span>
			</header>

			<FlowchartValidationPanel
				{...diagramCounts(diagram)}
				intermediateMessage={validationMessage}
				realSceneIssueCount={realSceneIssueCount}
				realSceneMessage={realSceneMessage}
			/>

			<DiagramPreview scene={scene} />
		</section>
	);
}
