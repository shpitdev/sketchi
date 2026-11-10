import { convertSceneToExcalidraw, type ExcalidrawScene } from "@sketchi/diagram-excalidraw";
import {
	fetchStudioDiagramDetails,
	fetchStudioDiagramDrawing,
	type StudioDiagramSummary,
	type StudioDrawing,
	type StudioProjectSummary,
} from "@sketchi/studio-projects/client";

import { fetchArtifactScene } from "@/features/artifacts/artifact-view-client";

export interface DiagramDrawing {
	diagram: StudioDiagramSummary;
	project: StudioProjectSummary;
	scene: ExcalidrawScene;
}

/** The diagram's saved drawing, or its generated scene before the first Save. */
export async function fetchDiagramDrawing(
	diagramId: string,
	signal: AbortSignal,
): Promise<DiagramDrawing> {
	const details = await fetchStudioDiagramDetails(diagramId, signal);
	const scene = details.diagram.savedAt
		? sceneFromDrawing(await fetchStudioDiagramDrawing(diagramId, signal))
		: convertSceneToExcalidraw(await fetchArtifactScene(details.diagram.artifactId, signal));
	return { ...details, scene };
}

export function sceneFromDrawing(drawing: StudioDrawing): ExcalidrawScene {
	return {
		appState: { ...drawing.appState },
		// Stored drawings are validated Excalidraw elements; this is the one cast back.
		elements: drawing.elements as unknown as ExcalidrawScene["elements"],
		files: drawing.files as NonNullable<ExcalidrawScene["files"]>,
	};
}

/** What a Save stores: live elements, the background, and the image files they use. */
export function drawingFromScene(scene: ExcalidrawScene): StudioDrawing {
	const elements = scene.elements.filter((element) => !element.isDeleted);
	const fileIds = new Set(
		elements.flatMap((element) => (typeof element.fileId === "string" ? [element.fileId] : [])),
	);
	const files = Object.fromEntries(
		Object.entries(scene.files ?? {}).filter(([fileId]) => fileIds.has(fileId)),
	);
	const background = scene.appState.viewBackgroundColor;
	return {
		appState: typeof background === "string" ? { viewBackgroundColor: background } : {},
		elements,
		files,
	};
}

/**
 * Identifies the drawing's content cheaply. Excalidraw bumps an element's version on
 * every content edit and never for selection, scrolling or zoom.
 */
export function drawingSignature(scene: ExcalidrawScene): string {
	const background = scene.appState.viewBackgroundColor;
	let signature = typeof background === "string" ? background : "";
	for (const element of scene.elements) {
		if (!element.isDeleted) signature += `|${element.id}:${String(element.version)}`;
	}
	return signature;
}
