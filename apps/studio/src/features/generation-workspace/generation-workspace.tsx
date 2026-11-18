import { Result } from "effect";
import { useMemo } from "react";

import {
	type CanonicalDiagram,
	renderDiagram,
	familyForType,
	validateCanonicalDiagram,
} from "@sketchi/diagrams/family";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";

import { DrawingEditor } from "@sketchi/editor-surface";
import { FlowchartValidationPanel } from "../flowchart-validation-panel/index";

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

export function GenerationWorkspace({ diagram, status = "ready" }: GenerationWorkspaceProps) {
	const rendered = useMemo(() => {
		return Result.flatMap(validateCanonicalDiagram(diagram), () =>
			Result.map(renderDiagram(diagram), (scene) => {
				const realSceneValidation = validateExcalidrawScene(convertSceneToExcalidraw(scene));
				const realSceneIssueCount = realSceneValidation.issues.length;
				const realSceneMessage =
					realSceneIssueCount > 0
						? `${realSceneIssueCount} real-scene issues`
						: scene.elements.some((element) => element.type === "arrow")
							? "All arrows are bound"
							: "No real-scene issues";
				return {
					validationMessage: `Validated ${diagram.type} IR`,
					scene,
					realSceneIssueCount,
					realSceneMessage,
				};
			}),
		);
	}, [diagram]);

	return (
		<section className="sketchi-generation-workspace">
			<header className="sketchi-generation-workspace__header">
				<div>
					<h1>{diagram.title}</h1>
				</div>
				<span className="sketchi-generation-workspace__status">{statusLabels[status]}</span>
			</header>

			{Result.match(rendered, {
				onFailure: (error) => <p role="alert">{error.message}</p>,
				onSuccess: ({ validationMessage, scene, realSceneIssueCount, realSceneMessage }) => (
					<>
						<FlowchartValidationPanel
							{...familyForType(diagram.type).counts(diagram)}
							intermediateMessage={validationMessage}
							realSceneIssueCount={realSceneIssueCount}
							realSceneMessage={realSceneMessage}
						/>
						<DrawingEditor
							title={scene.title}
							revision={JSON.stringify(scene)}
							scene={convertSceneToExcalidraw(scene)}
							viewModeEnabled={true}
							zenModeEnabled={true}
						/>
					</>
				),
			})}
		</section>
	);
}
