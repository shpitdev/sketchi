import { SpanContent } from "@sketchi/observability";
import { Context, Effect, Schema } from "effect";

import {
	CreateStudioProjectFromArtifactRequestSchema,
	StudioDrawingSchema,
	StudioRecordIdSchema,
} from "../contracts.js";
import { StudioInvalidInputError, StudioNotFoundError, type StudioHttpError } from "./errors.js";
import { StudioProjects } from "./service.js";
import { StudioSessionService, type StudioSessionResolution } from "./session.js";

type RequestedResource = "diagram" | "project";

const readRequestJson = Effect.fn("studioPersistence.http.readJson")(function* (request: Request) {
	const body: unknown = yield* Effect.tryPromise({
		try: () => request.json(),
		catch: (cause) =>
			StudioInvalidInputError.make({
				cause,
				message: "A playground artifactId is required.",
			}),
	});
	yield* Effect.annotateCurrentSpan(SpanContent.httpRequestBody, body);
	return body;
});

/** A saved drawing carries its image files inline, so it gets more room than a record. */
export const STUDIO_DRAWING_MAX_BYTES = 16 * 1024 * 1024;

const drawingTooLarge = () =>
	StudioInvalidInputError.make({ message: "The drawing is too large to save." });

const readDrawingJson = Effect.fn("studioPersistence.http.readDrawing")(function* (
	request: Request,
) {
	const contentLength = Number(request.headers.get("Content-Length"));
	if (Number.isFinite(contentLength) && contentLength > STUDIO_DRAWING_MAX_BYTES) {
		return yield* drawingTooLarge();
	}
	const text = yield* Effect.tryPromise({
		try: () => request.text(),
		catch: (cause) => StudioInvalidInputError.make({ cause, message: "A drawing is required." }),
	});
	if (new TextEncoder().encode(text).byteLength > STUDIO_DRAWING_MAX_BYTES) {
		return yield* drawingTooLarge();
	}
	// The drawing is not recorded on the span: it can be megabytes of image data.
	const body = yield* Effect.try({
		try: (): unknown => JSON.parse(text),
		catch: (cause) => StudioInvalidInputError.make({ cause, message: "A drawing is required." }),
	});
	return yield* Schema.decodeUnknownEffect(StudioDrawingSchema, { errors: "all" })(body).pipe(
		Effect.mapError((cause) =>
			StudioInvalidInputError.make({
				cause,
				message: "The drawing is not a valid Excalidraw scene.",
			}),
		),
	);
});

function responseHeaders(resolution?: StudioSessionResolution): Headers {
	const headers = new Headers({
		"Cache-Control": "no-store",
	});

	if (resolution?.setCookie) {
		headers.append("Set-Cookie", resolution.setCookie);
	}

	return headers;
}

function jsonWithSession(
	resolution: StudioSessionResolution | undefined,
	body: unknown,
	status = 200,
): Response {
	return Response.json(body, {
		headers: responseHeaders(resolution),
		status,
	});
}

function missingResourceMessage(resource: RequestedResource): string {
	return resource === "project"
		? "Studio project was not found for this session."
		: "Studio diagram was not found for this session.";
}

/** The package's only typed-failure to public HTTP contract mapping. */
function failureResponse(
	resolution: StudioSessionResolution | undefined,
	error: StudioHttpError,
	requestedResource?: RequestedResource,
): Response {
	switch (error._tag) {
		case "StudioInvalidInputError":
			return jsonWithSession(
				resolution,
				{ code: "invalid_input", message: error.message, ok: false },
				400,
			);
		case "StudioNotFoundError":
		case "StudioOwnershipError": {
			const resource =
				requestedResource ??
				(error.resource === "diagram" || error.resource === "project" ? error.resource : undefined);

			if (!resource) {
				return jsonWithSession(
					resolution,
					{
						code: "storage_failed",
						message: "Studio persistence failed.",
						ok: false,
					},
					500,
				);
			}

			return jsonWithSession(
				resolution,
				{
					code: "not_found",
					message: missingResourceMessage(resource),
					ok: false,
				},
				404,
			);
		}
		case "StudioSourceArtifactError":
			return jsonWithSession(
				resolution,
				{ code: error.code, message: error.message, ok: false },
				error.status,
			);
		case "StudioDecodeError":
			return jsonWithSession(
				resolution,
				{
					code: "storage_failed",
					message: "Studio persistence failed.",
					ok: false,
				},
				500,
			);
		case "StudioSessionError":
			return jsonWithSession(
				resolution,
				{
					code: "storage_failed",
					message: "Studio session could not be resolved.",
					ok: false,
				},
				500,
			);
		case "StudioStorageError":
			return jsonWithSession(
				resolution,
				{
					code: "storage_failed",
					message: "Studio persistence failed.",
					ok: false,
				},
				500,
			);
	}
}

function withStudioSession(
	request: Request,
	requestedResource: RequestedResource | undefined,
	operation: (
		resolution: StudioSessionResolution,
		projects: Context.Service.Shape<typeof StudioProjects>,
	) => Effect.Effect<Response, StudioHttpError>,
) {
	return Effect.gen(function* () {
		const sessions = yield* StudioSessionService;
		const projects = yield* StudioProjects;

		return yield* sessions.resolve(request).pipe(
			Effect.matchEffect({
				onFailure: (error) => Effect.succeed(failureResponse(undefined, error, requestedResource)),
				onSuccess: (resolution) =>
					operation(resolution, projects).pipe(
						Effect.match({
							onFailure: (error) => failureResponse(resolution, error, requestedResource),
							onSuccess: (response) => response,
						}),
					),
			}),
		);
	});
}

export const handleListProjectsRequestEffect = Effect.fn("studioPersistence.http.listProjects")(
	function* (request: Request) {
		return yield* withStudioSession(request, undefined, (resolution, projects) =>
			projects.listProjects(resolution.session).pipe(
				Effect.map((projectSummaries) =>
					jsonWithSession(resolution, {
						auth: resolution.auth,
						ok: true,
						projects: projectSummaries,
						session: resolution.publicSession,
					}),
				),
			),
		);
	},
);

export const handleCreateFromArtifactRequestEffect = Effect.fn(
	"studioPersistence.http.createFromArtifact",
)(function* (request: Request) {
	return yield* withStudioSession(request, undefined, (resolution, projects) =>
		Effect.gen(function* () {
			const body = yield* readRequestJson(request);
			const parsed = yield* Schema.decodeUnknownEffect(
				CreateStudioProjectFromArtifactRequestSchema,
				{ errors: "all" },
			)(body).pipe(
				Effect.mapError((cause) =>
					StudioInvalidInputError.make({
						cause,
						message: "A playground artifactId is required.",
					}),
				),
			);

			const result = yield* projects.createFromArtifact({
				artifactId: parsed.artifactId,
				session: resolution.session,
			});

			return jsonWithSession(resolution, {
				auth: resolution.auth,
				diagram: result.diagram,
				ok: true,
				project: result.project,
				session: resolution.publicSession,
				urls: result.urls,
			});
		}),
	);
});

export const handleGetProjectRequestEffect = Effect.fn("studioPersistence.http.getProject")(
	function* (request: Request, projectId: string) {
		return yield* withStudioSession(request, "project", (resolution, projects) =>
			Schema.decodeUnknownEffect(StudioRecordIdSchema)(projectId).pipe(
				Effect.mapError(() => StudioNotFoundError.make({ id: projectId, resource: "project" })),
				Effect.flatMap((id) => projects.getProject(resolution.session, id)),
				Effect.map((details) =>
					jsonWithSession(resolution, {
						auth: resolution.auth,
						details,
						ok: true,
						session: resolution.publicSession,
					}),
				),
			),
		);
	},
);

export const handleGetDiagramRequestEffect = Effect.fn("studioPersistence.http.getDiagram")(
	function* (request: Request, diagramId: string) {
		return yield* withStudioSession(request, "diagram", (resolution, projects) =>
			Schema.decodeUnknownEffect(StudioRecordIdSchema)(diagramId).pipe(
				Effect.mapError(() => StudioNotFoundError.make({ id: diagramId, resource: "diagram" })),
				Effect.flatMap((id) => projects.getDiagram(resolution.session, id)),
				Effect.map((details) =>
					jsonWithSession(resolution, {
						auth: resolution.auth,
						diagram: details.diagram,
						ok: true,
						project: details.project,
						session: resolution.publicSession,
					}),
				),
			),
		);
	},
);

function decodeDiagramId(diagramId: string) {
	return Schema.decodeUnknownEffect(StudioRecordIdSchema)(diagramId).pipe(
		Effect.mapError(() => StudioNotFoundError.make({ id: diagramId, resource: "diagram" })),
	);
}

export const handleGetDrawingRequestEffect = Effect.fn("studioPersistence.http.getDrawing")(
	function* (request: Request, diagramId: string) {
		return yield* withStudioSession(request, "diagram", (resolution, projects) =>
			decodeDiagramId(diagramId).pipe(
				Effect.flatMap((id) => projects.getDrawing(resolution.session, id)),
				Effect.map((drawing) =>
					jsonWithSession(resolution, {
						auth: resolution.auth,
						drawing,
						ok: true,
						session: resolution.publicSession,
					}),
				),
			),
		);
	},
);

export const handleSaveDrawingRequestEffect = Effect.fn("studioPersistence.http.saveDrawing")(
	function* (request: Request, diagramId: string) {
		return yield* withStudioSession(request, "diagram", (resolution, projects) =>
			Effect.gen(function* () {
				const id = yield* decodeDiagramId(diagramId);
				const drawing = yield* readDrawingJson(request);
				const diagram = yield* projects.saveDrawing(resolution.session, id, drawing);
				return jsonWithSession(resolution, {
					auth: resolution.auth,
					diagram,
					ok: true,
					session: resolution.publicSession,
				});
			}),
		);
	},
);
