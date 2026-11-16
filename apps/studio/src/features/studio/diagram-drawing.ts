import { convertSceneToExcalidraw, type ExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Effect, Array, Record, Schema } from "effect";
import { HttpApiClient } from "effect/http-api";
import { StudioHttpApi } from "../projects/http-api";
import { Atom } from "effect/reactivity";
import { StudioRecordIdSchema } from "../projects/contracts";
import type {
	StudioDiagramSummary,
	StudioDrawing,
	StudioProjectSummary,
} from "../projects/contracts";
import { StudioApi, projectsRuntime } from "../projects/client";
import { loadArtifactReview } from "../artifacts/artifact-view-client";
import { readDrawingDraft } from "./drawing-drafts";

const decodeDrawing = HttpApiClient.decodeResponse(StudioHttpApi, {
	group: "projects",
	endpoint: "drawing",
});

export interface DiagramDrawing {
	diagram: StudioDiagramSummary;
	project: StudioProjectSummary;
	scene: ExcalidrawScene;
}

/** The diagram's saved drawing, or its generated scene before the first Save. */
export const loadDiagramDrawing = Effect.fn("Studio.diagram.drawing")(function* (
	diagramId: string,
) {
	const id = yield* Schema.decodeUnknownEffect(StudioRecordIdSchema)(diagramId);
	const api = yield* StudioApi;
	const details = yield* api.projects.diagram({ params: { diagramId: id } });
	const stored = yield* api.projects.drawing({
		params: { diagramId: id },
		responseMode: "response-only",
	});
	// A saved drawing is authoritative, including drawings written before metadata
	// publication changed. Only an actual 404 falls back to the generated artifact.
	const scene =
		stored.status === 404
			? convertSceneToExcalidraw((yield* loadArtifactReview(details.diagram.artifactId)).scene)
			: sceneFromDrawing((yield* decodeDrawing(stored)).drawing);
	return { diagram: details.diagram, project: details.project, scene };
});
export const diagramDrawing = Atom.family((diagramId: string) =>
	projectsRuntime
		.atom(loadDiagramDrawing(diagramId))
		.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial),
);
export const editableDiagramDrawing = Atom.family((diagramId: string) =>
	projectsRuntime
		.atom(
			Effect.all(
				{ drawing: loadDiagramDrawing(diagramId), draft: readDrawingDraft(diagramId) },
				{ concurrency: 2 },
			).pipe(
				Effect.map(({ drawing, draft }) => ({
					...drawing,
					draft: draft ? sceneFromDrawing(draft) : undefined,
				})),
			),
		)
		.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial),
);

export function sceneFromDrawing(drawing: StudioDrawing): ExcalidrawScene {
	return {
		appState: { ...drawing.appState },
		// Stored drawings are validated Excalidraw elements; this is the one cast back.
		elements: drawing.elements as unknown as ExcalidrawScene["elements"],
		files: drawing.files,
	};
}

/** What a Save stores: live elements, the background, and the image files they use. */
export function drawingFromScene(scene: ExcalidrawScene): StudioDrawing {
	const elements = Array.filter(scene.elements, (element) => !element.isDeleted);
	const fileIds = new Set(
		Array.flatMap(elements, (element) =>
			typeof element.fileId === "string" ? [element.fileId] : [],
		),
	);
	const files = Record.fromEntries(
		Array.filter(Record.toEntries(scene.files ?? {}), ([fileId]) => fileIds.has(fileId)),
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
