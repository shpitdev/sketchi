import { Schema, Array } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

import {
	CreateStudioProjectFromArtifactRequest,
	CreateStudioProjectFromArtifactResponse,
	SaveStudioDrawingResponse,
	StudioDiagramDetailsResponse,
	StudioDrawing,
	StudioDrawingResponse,
	StudioProjectDetailsResponse,
	StudioProjectsListResponse,
} from "./contracts";

// Preserve the existing public JSON error envelope, including source-artifact errors.
export const StudioHttpFailure = Schema.Struct({
	ok: Schema.Literal(false),
	code: Schema.String,
	message: Schema.String,
});
const failures = Array.map([400, 404, 422, 500], (status) =>
	StudioHttpFailure.pipe(HttpApiSchema.status(status)),
);
const diagramParams = { diagramId: Schema.String };

export const StudioHttpApi = HttpApi.make("StudioProjectsApi").add(
	HttpApiGroup.make("projects").add(
		HttpApiEndpoint.get("list", "/api/studio/projects", {
			success: StudioProjectsListResponse,
			error: failures,
		}),
		HttpApiEndpoint.post("create", "/api/studio/projects/from-artifact", {
			payload: CreateStudioProjectFromArtifactRequest,
			success: CreateStudioProjectFromArtifactResponse,
			error: failures,
		}),
		HttpApiEndpoint.get("project", "/api/studio/projects/:projectId", {
			params: { projectId: Schema.String },
			success: StudioProjectDetailsResponse,
			error: failures,
		}),
		HttpApiEndpoint.get("diagram", "/api/studio/diagrams/:diagramId", {
			params: diagramParams,
			success: StudioDiagramDetailsResponse,
			error: failures,
		}),
		HttpApiEndpoint.get("drawing", "/api/studio/diagrams/:diagramId/drawing", {
			params: diagramParams,
			success: StudioDrawingResponse,
			error: failures,
		}),
		HttpApiEndpoint.put("save", "/api/studio/diagrams/:diagramId/drawing", {
			params: diagramParams,
			payload: StudioDrawing,
			success: SaveStudioDrawingResponse,
			error: failures,
		}),
	),
);
