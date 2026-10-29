import { useMemo } from "react";

import {
	type CanonicalDiagram,
	validateCanonicalDiagram,
	wireframeComponents,
} from "@sketchi/diagram-core";
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
	// Timeline events sit on an axis rather than connecting; count their phases.
	if (diagram.type === "timeline")
		return {
			nodeCount: diagram.events.length,
			nodeNoun: "events",
			edgeCount: diagram.events.filter((event) => event.end !== undefined).length,
			edgeNoun: "phases",
		};
	if (diagram.type === "chart")
		return {
			nodeCount: diagram.categories.length,
			nodeNoun: diagram.kind === "pie" ? "slices" : "categories",
			edgeCount: diagram.series.length,
			edgeNoun: "series",
		};
	if (diagram.type === "gantt")
		return {
			nodeCount: diagram.tasks.length,
			nodeNoun: "tasks",
			edgeCount: diagram.tasks.reduce((count, task) => count + (task.dependsOn?.length ?? 0), 0),
			edgeNoun: "dependencies",
		};
	if (diagram.type === "state-machine")
		return {
			nodeCount: diagram.states.length,
			nodeNoun: "states",
			edgeCount: diagram.transitions.length,
			edgeNoun: "transitions",
		};
	if (diagram.type === "er")
		return {
			nodeCount: diagram.entities.length,
			nodeNoun: "entities",
			edgeCount: diagram.relationships.length,
			edgeNoun: "relationships",
		};
	if (diagram.type === "class")
		return {
			nodeCount: diagram.classes.length,
			nodeNoun: "classes",
			edgeCount: diagram.relationships.length,
			edgeNoun: "relationships",
		};
	if (diagram.type === "sankey")
		return {
			nodeCount: diagram.nodes.length,
			nodeNoun: "nodes",
			edgeCount: diagram.links.length,
			edgeNoun: "flows",
		};
	if (diagram.type === "org-chart")
		return {
			nodeCount: diagram.people.length,
			nodeNoun: "people",
			edgeCount:
				diagram.people.filter((person) => person.manager !== undefined).length +
				diagram.dottedLines.length,
			edgeNoun: "reporting lines",
		};
	if (diagram.type === "venn")
		return {
			nodeCount: diagram.sets.length,
			nodeNoun: "sets",
			edgeCount: diagram.regions.reduce((count, region) => count + (region.items?.length ?? 0), 0),
			edgeNoun: "items",
		};
	if (diagram.type === "journey")
		return {
			nodeCount: diagram.stages.reduce((total, stage) => total + stage.steps.length, 0),
			nodeNoun: "steps",
			edgeCount: diagram.stages.length,
			edgeNoun: "stages",
		};
	if (diagram.type === "wireframe")
		return {
			nodeCount: [...wireframeComponents(diagram)].length,
			nodeNoun: "components",
			edgeCount: diagram.screens.length,
			edgeNoun: diagram.screens.length === 1 ? "screen" : "screens",
		};
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
			realSceneIssueCount > 0
				? `${realSceneIssueCount} real-scene issues`
				: scene.elements.some((element) => element.type === "arrow")
					? "All arrows are bound"
					: "No real-scene issues";
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
