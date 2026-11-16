import { SpanContent } from "@sketchi/observability";
import { ByteSize, Effect, Layer } from "effect";
import {
	HttpIncomingMessage,
	HttpRouter,
	HttpServer,
	HttpServerError,
	HttpServerRequest,
	HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware, HttpApiSchema } from "effect/http-api";
import {
	STUDIO_DRAWING_MAX_BYTES,
	StudioHttpApi,
	StudioSchemaErrors,
	StudioSessionMiddleware,
	type StudioFailure,
} from "./http-api";
import { StudioProjects } from "./service.server";
import {
	CurrentStudioSession,
	StudioSessionService,
	type StudioSessionResolution,
} from "./session.server";
import type { StudioProjectsError } from "./errors.server";

type FailureBody = StudioFailure["body"];
function responseHeaders(resolution?: StudioSessionResolution) {
	return {
		"cache-control": "no-store" as const,
		...(resolution?.setCookie ? { "set-cookie": resolution.setCookie } : {}),
	};
}
function missing(resource: "project" | "diagram"): FailureBody {
	return {
		ok: false,
		status: 404,
		code: "not_found",
		message:
			resource === "project"
				? "Studio project was not found for this session."
				: "Studio diagram was not found for this session.",
	};
}
function unavailable(message = "Studio persistence failed."): FailureBody {
	return { ok: false, status: 500, code: "storage_failed", message };
}
function domainFailure(error: StudioProjectsError, resource?: "project" | "diagram"): FailureBody {
	switch (error._tag) {
		case "StudioNotFoundError":
		case "StudioOwnershipError": {
			const requested =
				resource ??
				(error.resource === "project" || error.resource === "diagram" ? error.resource : undefined);
			return requested ? missing(requested) : unavailable();
		}
		case "StudioSourceArtifactError":
			return {
				ok: false,
				status: error.status === 404 ? 404 : error.status === 422 ? 422 : 500,
				code: error.code,
				message: error.message,
			};
		case "StudioDecodeError":
		case "StudioStorageError":
			return unavailable();
	}
}
function withFailureHeaders(
	body: FailureBody,
	resolution?: StudioSessionResolution,
): StudioFailure {
	const headers = responseHeaders(resolution);
	switch (body.status) {
		case 400:
			return HttpApiSchema.withHeaders({ body, headers });
		case 404:
			return HttpApiSchema.withHeaders({ body, headers });
		case 422:
			return HttpApiSchema.withHeaders({ body, headers });
		case 500:
			return HttpApiSchema.withHeaders({ body, headers });
	}
}
// Only the concrete domain-to-public failure policy remains here. HttpApi owns
// route parameters, payload decoding, response encoding, status and headers.
const publicFailure = (resource?: "project" | "diagram") => (error: StudioProjectsError) =>
	CurrentStudioSession.pipe(
		Effect.flatMap((session) =>
			Effect.fail(withFailureHeaders(domainFailure(error, resource), session)),
		),
	);

const SessionLive = Layer.effect(
	StudioSessionMiddleware,
	Effect.gen(function* () {
		const sessions = yield* StudioSessionService;
		return StudioSessionMiddleware.of((httpEffect, { endpoint }) =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest;
				const webRequest = yield* HttpServerRequest.toWeb(request).pipe(
					Effect.mapError(() =>
						withFailureHeaders(unavailable("Studio session could not be resolved.")),
					),
				);
				const resolution = yield* sessions
					.resolve(webRequest)
					.pipe(
						Effect.mapError(() =>
							withFailureHeaders(unavailable("Studio session could not be resolved.")),
						),
					);
				const program = httpEffect.pipe(
					Effect.provideService(CurrentStudioSession, resolution),
					Effect.map((response) =>
						HttpServerResponse.setHeaders(response, responseHeaders(resolution)),
					),
					// Installed HttpApiBuilder.decodePayload promotes buffered request read
					// failures via Effect.orDie. Translate only this native request boundary;
					// native MaxBodySize still counts bytes and cancels the actual stream.
					Effect.catchDefect((cause) =>
						HttpServerError.isHttpServerError(cause) && cause.reason._tag === "RequestParseError"
							? Effect.fail(
									withFailureHeaders(
										{
											ok: false,
											status: 400,
											code: "invalid_input",
											message:
												cause.reason.reason === "BodyTooLarge"
													? "The drawing is too large to save."
													: endpoint.identifier === "create"
														? "A playground artifactId is required."
														: "A drawing is required.",
										},
										resolution,
									),
								)
							: Effect.die(cause),
					),
				);
				return yield* endpoint.identifier === "save"
					? program.pipe(
							Effect.provideService(
								HttpIncomingMessage.MaxBodySize,
								ByteSize.bytes(STUDIO_DRAWING_MAX_BYTES),
							),
						)
					: program;
			}),
		);
	}),
);
const SchemaErrorsLive = HttpApiMiddleware.layerSchemaErrorTransform(
	StudioSchemaErrors,
	(error, { endpoint }) =>
		CurrentStudioSession.pipe(
			Effect.flatMap((session) =>
				Effect.fail(
					withFailureHeaders(
						error.kind === "Params"
							? missing(endpoint.identifier === "project" ? "project" : "diagram")
							: error.kind === "Body" || error.kind === "ResponseHeaders"
								? unavailable()
								: {
										ok: false,
										status: 400,
										code: "invalid_input",
										message:
											endpoint.identifier === "create"
												? "A playground artifactId is required."
												: "The drawing is not a valid Excalidraw scene.",
									},
						session,
					),
				),
			),
		),
);
const Handlers = HttpApiBuilder.group(StudioHttpApi, "projects", (handlers) =>
	handlers
		.handle("list", () =>
			Effect.gen(function* () {
				const session = yield* CurrentStudioSession;
				const projects = yield* StudioProjects;
				const summaries = yield* projects
					.listProjects(session.session)
					.pipe(Effect.catch(publicFailure()));
				return {
					auth: session.auth,
					ok: true as const,
					projects: summaries,
					session: session.publicSession,
				};
			}),
		)
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const session = yield* CurrentStudioSession;
				const projects = yield* StudioProjects;
				yield* Effect.annotateCurrentSpan(SpanContent.httpRequestBody, payload);
				const result = yield* projects
					.createFromArtifact({ artifactId: payload.artifactId, session: session.session })
					.pipe(Effect.catch(publicFailure()));
				return { ...result, auth: session.auth, session: session.publicSession };
			}),
		)
		.handle("project", ({ params }) =>
			Effect.gen(function* () {
				const session = yield* CurrentStudioSession;
				const projects = yield* StudioProjects;
				const details = yield* projects
					.getProject(session.session, params.projectId)
					.pipe(Effect.catch(publicFailure("project")));
				return { auth: session.auth, ok: true as const, details, session: session.publicSession };
			}),
		)
		.handle("diagram", ({ params }) =>
			Effect.gen(function* () {
				const session = yield* CurrentStudioSession;
				const projects = yield* StudioProjects;
				const details = yield* projects
					.getDiagram(session.session, params.diagramId)
					.pipe(Effect.catch(publicFailure("diagram")));
				return {
					...details,
					auth: session.auth,
					ok: true as const,
					session: session.publicSession,
				};
			}),
		)
		.handle("drawing", ({ params }) =>
			Effect.gen(function* () {
				const session = yield* CurrentStudioSession;
				const projects = yield* StudioProjects;
				const drawing = yield* projects
					.getDrawing(session.session, params.diagramId)
					.pipe(Effect.catch(publicFailure("diagram")));
				return { auth: session.auth, ok: true as const, drawing, session: session.publicSession };
			}),
		)
		.handle("save", ({ params, payload }) =>
			Effect.gen(function* () {
				const session = yield* CurrentStudioSession;
				const projects = yield* StudioProjects;
				const diagram = yield* projects
					.saveDrawing(session.session, params.diagramId, payload)
					.pipe(Effect.catch(publicFailure("diagram")));
				return { auth: session.auth, ok: true as const, diagram, session: session.publicSession };
			}),
		),
);
export const studioHttp = HttpRouter.toHttpEffect(
	HttpApiBuilder.layer(StudioHttpApi).pipe(
		Layer.provide(Handlers.pipe(Layer.provide(Layer.merge(SessionLive, SchemaErrorsLive)))),
		Layer.provide(HttpServer.layerServices),
	),
).pipe(Effect.provideService(HttpRouter.RouterConfig, { maxParamLength: 2048 }));
