import { Result, Schema } from "effect";

import {
	CreateStudioProjectFromArtifactResponseSchema,
	SaveStudioDrawingResponse,
	StudioDiagramDetailsResponse,
	StudioDrawingResponse,
	StudioProjectDetailsResponse,
	StudioProjectsListResponse,
	type CreateStudioProjectFromArtifactResponse,
	type StudioDiagramSummary,
	type StudioDrawing,
	type StudioProjectDetails,
	type StudioProjectSummary,
	studioDiagramDrawingApiUrl,
} from "./contracts.js";

export async function fetchStudioProjects(signal?: AbortSignal): Promise<StudioProjectSummary[]> {
	const response = await fetch("/api/studio/projects", signal ? { signal } : {});
	const payload: unknown = await response.json();
	const parsed = Schema.decodeUnknownResult(StudioProjectsListResponse)(payload);

	if (!response.ok || Result.isFailure(parsed)) {
		throw new Error("Studio projects could not be loaded.");
	}

	return parsed.success.projects;
}

export async function fetchStudioProjectDetails(
	projectId: string,
	signal?: AbortSignal,
): Promise<StudioProjectDetails> {
	const response = await fetch(
		`/api/studio/projects/${encodeURIComponent(projectId)}`,
		signal ? { signal } : {},
	);
	const payload: unknown = await response.json();
	const parsed = Schema.decodeUnknownResult(StudioProjectDetailsResponse)(payload);

	if (!response.ok || Result.isFailure(parsed)) {
		throw new Error("Studio project could not be loaded.");
	}

	return parsed.success.details;
}

export async function fetchStudioDiagramDetails(
	diagramId: string,
	signal?: AbortSignal,
): Promise<{
	diagram: StudioDiagramSummary;
	project: StudioProjectSummary;
}> {
	const response = await fetch(
		`/api/studio/diagrams/${encodeURIComponent(diagramId)}`,
		signal ? { signal } : {},
	);
	const payload: unknown = await response.json();
	const parsed = Schema.decodeUnknownResult(StudioDiagramDetailsResponse)(payload);

	if (!response.ok || Result.isFailure(parsed)) {
		throw new Error("Studio diagram could not be loaded.");
	}

	return {
		diagram: parsed.success.diagram,
		project: parsed.success.project,
	};
}

export async function createStudioProjectFromArtifact(
	artifactId: string,
): Promise<CreateStudioProjectFromArtifactResponse> {
	const response = await fetch("/api/studio/projects/from-artifact", {
		body: JSON.stringify({ artifactId }),
		headers: {
			"Content-Type": "application/json",
		},
		method: "POST",
	});
	const payload: unknown = await response.json();
	const parsed = Schema.decodeUnknownResult(CreateStudioProjectFromArtifactResponseSchema)(payload);

	if (!response.ok || Result.isFailure(parsed)) {
		throw new Error("Artifact could not be saved to Studio.");
	}

	return parsed.success;
}

export async function fetchStudioDiagramDrawing(
	diagramId: string,
	signal?: AbortSignal,
): Promise<StudioDrawing> {
	const response = await fetch(studioDiagramDrawingApiUrl(diagramId), signal ? { signal } : {});
	const payload: unknown = await response.json();
	const parsed = Schema.decodeUnknownResult(StudioDrawingResponse)(payload);

	if (!response.ok || Result.isFailure(parsed)) {
		throw new Error("Studio drawing could not be loaded.");
	}

	return parsed.success.drawing;
}

/** Saves the drawing as the diagram's current drawing and returns the updated diagram. */
export async function saveStudioDiagramDrawing(
	diagramId: string,
	drawing: StudioDrawing,
): Promise<StudioDiagramSummary> {
	const response = await fetch(studioDiagramDrawingApiUrl(diagramId), {
		body: JSON.stringify(drawing),
		headers: { "Content-Type": "application/json" },
		method: "PUT",
	});
	const payload: unknown = await response.json().catch(() => null);
	const parsed = Schema.decodeUnknownResult(SaveStudioDrawingResponse)(payload);

	if (!response.ok || Result.isFailure(parsed)) {
		throw new Error("Drawing could not be saved.");
	}

	return parsed.success.diagram;
}
