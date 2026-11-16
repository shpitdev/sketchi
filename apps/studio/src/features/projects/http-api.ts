import { Schema, SchemaGetter } from "effect";
import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiMiddleware,
	HttpApiSchema,
} from "effect/http-api";
import type { CurrentStudioSession } from "./session.server";
import {
	CreateStudioProjectFromArtifactRequest,
	CreateStudioProjectFromArtifactResponse,
	SaveStudioDrawingResponse,
	StudioDiagramDetailsResponse,
	StudioDrawing,
	StudioDrawingResponse,
	StudioProjectDetailsResponse,
	StudioProjectsListResponse,
	StudioRecordIdSchema,
} from "./contracts";

export const STUDIO_DRAWING_MAX_BYTES = 16 * 1024 * 1024;
const FailureBody = Schema.Struct({
	ok: Schema.Literal(false),
	code: Schema.String,
	message: Schema.String,
});
export const StudioResponseHeaders = Schema.Struct({
	"cache-control": Schema.Literal("no-store"),
	"set-cookie": Schema.optionalKey(Schema.String),
});
// Status discriminates native error encoders internally. The codec removes it
// from the existing public {ok,code,message} JSON envelope.
const failure = <const Status extends number>(status: Status) =>
	HttpApiSchema.WithHeaders(
		FailureBody.pipe(
			Schema.decodeTo(Schema.Struct({ ...FailureBody.fields, status: Schema.Literal(status) }), {
				decode: SchemaGetter.transform((body) => ({ ...body, status })),
				encode: SchemaGetter.transform(({ status: _status, ...body }) => body),
			}),
		),
		StudioResponseHeaders,
	).pipe(HttpApiSchema.status(status));
export const StudioBadRequest = failure(400);
export const StudioMissing = failure(404);
export const StudioInvalidScene = failure(422);
export const StudioUnavailable = failure(500);
export type StudioFailure =
	| typeof StudioBadRequest.Type
	| typeof StudioMissing.Type
	| typeof StudioInvalidScene.Type
	| typeof StudioUnavailable.Type;
const failures = [StudioBadRequest, StudioMissing, StudioInvalidScene, StudioUnavailable];
export const StudioHttpFailure = Schema.Union(failures);
export class StudioSchemaErrors extends HttpApiMiddleware.Service<
	StudioSchemaErrors,
	{ requires: CurrentStudioSession }
>()("StudioProjectsSchemaErrors", { error: failures }) {}
export class StudioSessionMiddleware extends HttpApiMiddleware.Service<
	StudioSessionMiddleware,
	{ provides: CurrentStudioSession }
>()("StudioProjectsSession", { error: failures }) {}

// The deployed JSON wire omits undefined object fields. Canonical toCodecJson
// represents them as null; this native string codec preserves the actual wire.
const jsonWire = <S extends Schema.Top>(schema: S) =>
	Schema.fromJsonString(schema).pipe(HttpApiSchema.asText({ contentType: "application/json" }));

const diagramParams = { diagramId: StudioRecordIdSchema };
export const StudioHttpApi = HttpApi.make("StudioProjectsApi").add(
	HttpApiGroup.make("projects")
		.add(
			HttpApiEndpoint.get("list", "/api/studio/projects", {
				success: jsonWire(StudioProjectsListResponse),
			}),
			HttpApiEndpoint.post("create", "/api/studio/projects/from-artifact", {
				payload: CreateStudioProjectFromArtifactRequest,
				success: jsonWire(CreateStudioProjectFromArtifactResponse),
			}),
			HttpApiEndpoint.get("project", "/api/studio/projects/:projectId", {
				params: { projectId: StudioRecordIdSchema },
				success: jsonWire(StudioProjectDetailsResponse),
			}),
			HttpApiEndpoint.get("diagram", "/api/studio/diagrams/:diagramId", {
				params: diagramParams,
				success: jsonWire(StudioDiagramDetailsResponse),
			}),
			HttpApiEndpoint.get("drawing", "/api/studio/diagrams/:diagramId/drawing", {
				params: diagramParams,
				success: jsonWire(StudioDrawingResponse),
			}),
			HttpApiEndpoint.put("save", "/api/studio/diagrams/:diagramId/drawing", {
				params: diagramParams,
				// Native Excalidraw optional properties may be undefined. This native codec
				// preserves the existing JSON.stringify object wire by omitting those keys.
				payload: jsonWire(StudioDrawing),
				success: jsonWire(SaveStudioDrawingResponse),
			}),
		)
		.middleware(StudioSchemaErrors)
		.middleware(StudioSessionMiddleware),
);
