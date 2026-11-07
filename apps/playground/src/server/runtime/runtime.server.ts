import "@tanstack/react-start/server-only";

import {
	makeWorkersTelemetryLayer,
	SpanContent,
	toJsonValue,
	withTelemetryCorrelation,
	withTelemetryExport,
} from "@sketchi/observability";
import { Context, Deferred, Effect, FiberSet, Layer, ManagedRuntime, pipe } from "effect";

import type { CodeModeHttpRequestError } from "../codemode/api.server";
import type { McpTransportError } from "../codemode/mcp.server";
import { correlationIdHeader } from "./correlation.server";
import type { RequestBodyReadError } from "./request-body.server";
import type { StudioEnv } from "../bindings/studio-env.server";
import { PlaygroundAiModelLive } from "../ai/model.server";
import { PlaygroundCodeModeLive } from "../codemode/service.server";
import { PlaygroundGenerationLive } from "../generation/service.server";
import { PlaygroundCodeModeUsageLive } from "../codemode/usage-events.server";
import {
	handleCreateStudioProjectFromArtifactRequest,
	handleGetStudioDiagramRequest,
	handleGetStudioProjectRequest,
	handleListStudioProjectsRequest,
	PlaygroundStudioLayer,
	PlaygroundStudioLocalBucketLive,
} from "../studio/projects.server";
import {
	PlaygroundBindings,
	PlaygroundClockLive,
	PlaygroundIds,
	PlaygroundIdsLive,
	PlaygroundPlatformCallbacks,
	PlaygroundRequestMetadata,
	type PlaygroundPlatformBoundaryShape,
	type PlaygroundRequestServices,
} from "./context.server";

export interface PlaygroundRequestBoundary {
	readonly env: StudioEnv;
	readonly platform: PlaygroundPlatformBoundaryShape;
	readonly request: Request;
}

class PlaygroundCallbackFibers extends Context.Service<
	PlaygroundCallbackFibers,
	FiberSet.FiberSet<unknown, unknown>
>()("@sketchi/playground/PlaygroundCallbackFibers") {}

const PlaygroundCallbackFibersLive = Layer.effect(
	PlaygroundCallbackFibers,
	FiberSet.make<unknown, unknown>(),
);

const PlaygroundTelemetryLive = makeWorkersTelemetryLayer({
	resource: { serviceName: "sketchi-studio" },
});

const PlaygroundCoreLive = Layer.mergeAll(
	PlaygroundClockLive,
	PlaygroundIdsLive,
	PlaygroundAiModelLive,
	PlaygroundCallbackFibersLive,
	PlaygroundCodeModeLive,
	PlaygroundCodeModeUsageLive,
	PlaygroundGenerationLive,
	PlaygroundTelemetryLive,
);

export const PlaygroundHostLive = PlaygroundStudioLayer.pipe(
	Layer.provideMerge(Layer.merge(PlaygroundCoreLive, PlaygroundStudioLocalBucketLive)),
);

export type PlaygroundHostServices = Layer.Success<typeof PlaygroundHostLive>;

export type PlaygroundRequestEffect<A, E = never> = Effect.Effect<
	A,
	E,
	PlaygroundHostServices | PlaygroundRequestServices | PlaygroundRequestCallbacks
>;

export type PlaygroundCallbackEffect<A, E = never> = Effect.Effect<
	A,
	E,
	PlaygroundHostServices | PlaygroundRequestServices
>;

export type PlaygroundRequestRunner = <A, E>(effect: PlaygroundCallbackEffect<A, E>) => Promise<A>;

export interface PlaygroundRequestCallbacksShape {
	readonly runPromise: PlaygroundRequestRunner;
}

export class PlaygroundRequestCallbacks extends Context.Service<
	PlaygroundRequestCallbacks,
	PlaygroundRequestCallbacksShape
>()("@sketchi/playground/PlaygroundRequestCallbacks") {}

type PlaygroundHttpError = CodeModeHttpRequestError | McpTransportError | RequestBodyReadError;
type PlaygroundRequestResult<A, E> =
	| A
	| (unknown extends E ? Response : E extends PlaygroundHttpError ? Response : never);

export interface PlaygroundRuntime {
	readonly dispose: () => Promise<void>;
	readonly run: <A, E>(
		effect: PlaygroundRequestEffect<A, E>,
		boundary: PlaygroundRequestBoundary,
	) => Promise<PlaygroundRequestResult<A, E>>;
}

export {
	handleCreateStudioProjectFromArtifactRequest,
	handleGetStudioDiagramRequest,
	handleGetStudioProjectRequest,
	handleListStudioProjectsRequest,
};

function runWithPlaygroundRuntime<A, E>(
	runtime: ManagedRuntime.ManagedRuntime<PlaygroundHostServices, never>,
	effect: PlaygroundRequestEffect<A, E>,
	boundary: PlaygroundRequestBoundary,
): Promise<PlaygroundRequestResult<A, E>>;
function runWithPlaygroundRuntime<A, E>(
	runtime: ManagedRuntime.ManagedRuntime<PlaygroundHostServices, never>,
	effect: PlaygroundRequestEffect<A, E>,
	boundary: PlaygroundRequestBoundary,
): Promise<A | Response> {
	const rayId = boundary.request.headers.get("cf-ray") ?? undefined;
	const program = Effect.gen(function* () {
		const ids = yield* PlaygroundIds;
		const callbackFibers = yield* PlaygroundCallbackFibers;
		const url = new URL(boundary.request.url);
		const traceId =
			correlationIdHeader(boundary.request, "x-sketchi-trace-id") ?? ids.create("trace");
		const requestRoute = normalizedRequestRoute(url.pathname);
		const requestAnnotations = {
			"request.method": boundary.request.method,
			"request.route": requestRoute,
		};
		const correlation = { traceId };

		yield* Effect.annotateCurrentSpan({
			...requestAnnotations,
			...(rayId ? { "cf.ray_id": rayId } : {}),
			"http.request.headers": recordedHeaders(boundary.request.headers),
			"sketchi.trace_id": traceId,
			"url.full": boundary.request.url,
		});

		const requestSpan = yield* Effect.currentSpan;
		const runTrackedEffect =
			yield* FiberSet.runtimePromise(callbackFibers)<PlaygroundHostServices>();
		const withRequestContext = <A2, E2>(
			callbackEffect: PlaygroundCallbackEffect<A2, E2>,
			spanName: string,
		) =>
			callbackEffect.pipe(
				Effect.provide(requestContext),
				Effect.withSpan(spanName, { parent: requestSpan }),
				Effect.annotateSpans(requestAnnotations),
				Effect.annotateLogs(requestAnnotations),
				(callbackProgram) => withTelemetryCorrelation(callbackProgram, correlation),
			);
		const runDeferredEffect: PlaygroundRequestRunner = (callbackEffect) =>
			runTrackedEffect(withRequestContext(callbackEffect, "playground.request.deferred"));
		const recordStreamEnd = (recorded: Effect.Effect<void>) =>
			boundary.platform.waitUntilPromise(
				runTrackedEffect(
					withRequestContext(recorded, "playground.response.stream"),
					// Only disposing the runtime interrupts a stream still being read; that is not a failure.
				).catch(() => undefined),
			);
		const runRequestEffect: PlaygroundRequestRunner = (callbackEffect) =>
			runTrackedEffect(withRequestContext(callbackEffect, "playground.request.callback"), {
				signal: boundary.request.signal,
			});
		const requestContext = pipe(
			Context.empty(),
			Context.add(PlaygroundBindings, boundary.env),
			Context.add(PlaygroundPlatformCallbacks, {
				waitUntil: (deferredEffect) =>
					boundary.platform.waitUntilPromise(runDeferredEffect(deferredEffect)),
				waitUntilPromise: boundary.platform.waitUntilPromise,
			}),
			Context.add(PlaygroundRequestMetadata, {
				method: boundary.request.method,
				origin: url.origin,
				path: `${url.pathname}${url.search}`,
				request: boundary.request,
				traceId,
			}),
		);

		const httpEffect: PlaygroundRequestEffect<A, unknown> = effect;
		const errorResponse = (error: PlaygroundHttpError, status: number, message: string) =>
			Effect.logError("Playground HTTP request failed", {
				error_tag: error._tag,
			}).pipe(
				Effect.as(
					Response.json(
						{ ok: false, error: message },
						{ status, headers: { "Cache-Control": "no-store" } },
					),
				),
			);
		const result = yield* httpEffect.pipe(
			Effect.catchTags({
				CodeModeHttpRequestError: (error: CodeModeHttpRequestError) =>
					errorResponse(error, 400, "The request could not be decoded."),
				McpTransportError: (error: McpTransportError) =>
					errorResponse(error, 500, "The MCP transport failed."),
				RequestBodyReadError: (error: RequestBodyReadError) =>
					errorResponse(error, 400, "The request body could not be read."),
			}),
			Effect.provideService(PlaygroundRequestCallbacks, {
				runPromise: runRequestEffect,
			}),
			Effect.provide(requestContext),
			Effect.annotateSpans(requestAnnotations),
			Effect.annotateLogs(requestAnnotations),
			(requestEffect) => withTelemetryCorrelation(requestEffect, correlation),
		);
		if (!(result instanceof Response)) return result;
		yield* Effect.annotateCurrentSpan({
			"http.response.headers": recordedHeaders(result.headers),
			"http.response.status_code": result.status,
		});
		if (!result.body) return result;
		if (!isEventStream(result)) {
			// Every other body is complete once the handler returns, so reading a copy now
			// records it on this span without delaying the response.
			yield* recordBody(result, SpanContent.httpResponseBody);
			return result;
		}
		// A stream passes through unchanged, keeping its backpressure and cancellation, and
		// a child span records what passed once it ends.
		const streamed = recordStreamedBody(result, result.body);
		recordStreamEnd(streamed.recorded);
		return streamed.response;
	}).pipe(
		withTelemetryExport({
			pipeline: boundary.env.TELEMETRY_SPANS,
			rayId,
			waitUntil: boundary.platform.waitUntilPromise,
		}),
		Effect.withSpan("playground.request"),
	);

	return runtime.runPromise(program, {
		signal: boundary.request.signal,
	});
}

// Credentials, not content: a session cookie or bearer token in a shared table would let
// anyone who reads it act as that user.
const credentialHeaders = new Set(["authorization", "cookie", "proxy-authorization", "set-cookie"]);

function recordedHeaders(headers: Headers): Record<string, string> {
	const recorded: Record<string, string> = {};
	for (const [name, value] of headers) {
		if (!credentialHeaders.has(name)) recorded[name] = value;
	}
	return recorded;
}

function isEventStream(response: Response): boolean {
	return (response.headers.get("content-type") ?? "").startsWith("text/event-stream");
}

/** Passes a streamed body through unchanged and records the text that passed once it ends. */
function recordStreamedBody(
	response: Response,
	stream: ReadableStream<Uint8Array>,
): {
	readonly recorded: Effect.Effect<void>;
	readonly response: Response;
} {
	const ended = Deferred.makeUnsafe<{ readonly complete: boolean; readonly text: string }>();
	const decoder = new TextDecoder();
	let text = "";
	const end = (complete: boolean) => {
		text += decoder.decode();
		Deferred.doneUnsafe(ended, Effect.succeed({ complete, text }));
	};
	const reader = stream.getReader();
	// Pulls one chunk per read, so the client's pace and its cancellation reach the source.
	const body = new ReadableStream<Uint8Array>(
		{
			async pull(controller) {
				try {
					const chunk = await reader.read();
					if (chunk.done) {
						end(true);
						controller.close();
						return;
					}
					text += decoder.decode(chunk.value, { stream: true });
					controller.enqueue(chunk.value);
				} catch (error) {
					end(false);
					controller.error(error);
				}
			},
			cancel(reason) {
				end(false);
				return reader.cancel(reason);
			},
		},
		{ highWaterMark: 0 },
	);
	return {
		recorded: Effect.flatMap(Deferred.await(ended), (stream) =>
			Effect.annotateCurrentSpan({
				[SpanContent.httpResponseBody]: stream.text,
				// The client went away before the stream ended; the text is what it received.
				...(stream.complete ? {} : { "http.response.body.complete": false }),
			}),
		),
		response: new Response(body, response),
	};
}

function isTextBody(contentType: string): boolean {
	return (
		contentType === "" ||
		contentType.startsWith("text/") ||
		/\bjson\b|\bxml\b|x-www-form-urlencoded|javascript/.test(contentType)
	);
}

/** Records a copy of a complete response body on the current span; the original stays unread. */
function recordBody(message: Response, attribute: string): Effect.Effect<void> {
	if (!message.body) return Effect.void;
	if (message.bodyUsed) return Effect.annotateCurrentSpan(`${attribute}_error`, "already read");
	const copy = message.clone();
	const text = isTextBody(message.headers.get("content-type") ?? "");
	return Effect.tryPromise({
		try: async (): Promise<string | Uint8Array> =>
			text ? copy.text() : new Uint8Array(await copy.arrayBuffer()),
		catch: (cause) => cause,
	}).pipe(
		Effect.matchEffect({
			onFailure: (cause) => Effect.annotateCurrentSpan(`${attribute}_error`, toJsonValue(cause)),
			onSuccess: (body) => Effect.annotateCurrentSpan(attribute, body),
		}),
	);
}

function normalizedRequestRoute(pathname: string): string {
	const routePatterns: ReadonlyArray<readonly [RegExp, string]> = [
		[/^\/api\/v1\/artifacts\/[^/]+\/patch$/, "/api/v1/artifacts/:artifactId/patch"],
		[/^\/api\/v1\/artifacts\/[^/]+$/, "/api/v1/artifacts/:artifactId"],
		[/^\/api\/studio\/projects\/[^/]+$/, "/api/studio/projects/:projectId"],
		[/^\/api\/studio\/diagrams\/[^/]+$/, "/api/studio/diagrams/:diagramId"],
		[/^\/artifacts\/[^/]+\/edit$/, "/artifacts/:artifactId/edit"],
		[/^\/artifacts\/[^/]+$/, "/artifacts/:artifactId"],
		[/^\/diagrams\/[^/]+\/edit$/, "/diagrams/:diagramId/edit"],
		[/^\/diagrams\/[^/]+$/, "/diagrams/:diagramId"],
		[/^\/examples\/[^/]+$/, "/examples/:exampleId"],
		[/^\/projects\/[^/]+$/, "/projects/:projectId"],
	];
	for (const [pattern, route] of routePatterns) {
		if (pattern.test(pathname)) return route;
	}
	const staticRoutes = new Set([
		"/",
		"/api/chat",
		"/api/studio/projects",
		"/api/studio/projects/from-artifact",
		"/api/v1/flowcharts/build",
		"/api/v1/canvases/create",
		"/api/v1/generate",
		"/api/v1/mindmaps/build",
		"/api/v1/sequences/build",
		"/codemode-export-harness",
		"/mcp",
		"/projects",
	]);
	return staticRoutes.has(pathname) ? pathname : "/unmatched";
}

export function makePlaygroundRuntime(): PlaygroundRuntime {
	const runtime = ManagedRuntime.make(PlaygroundHostLive);
	return {
		dispose: () => runtime.dispose(),
		run: (effect, boundary) => runWithPlaygroundRuntime(runtime, effect, boundary),
	};
}

const playgroundRuntime = makePlaygroundRuntime();

export const runPlaygroundEffect = playgroundRuntime.run;
