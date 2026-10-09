import "@tanstack/react-start/server-only";

import {
  makeWorkersTelemetryLayer,
  withTelemetryCorrelation,
} from "@sketchi/observability";
import { Context, Effect, FiberSet, Layer, ManagedRuntime, pipe } from "effect";

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
  PlaygroundClock,
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
  resource: { serviceName: "sketchi-playground" },
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
  Layer.provideMerge(
    Layer.merge(PlaygroundCoreLive, PlaygroundStudioLocalBucketLive),
  ),
);

export type PlaygroundHostServices = Layer.Success<typeof PlaygroundHostLive>;

export type PlaygroundRequestEffect<A, E = never> = Effect.Effect<
  A,
  E,
  | PlaygroundHostServices
  | PlaygroundRequestServices
  | PlaygroundRequestCallbacks
>;

export type PlaygroundCallbackEffect<A, E = never> = Effect.Effect<
  A,
  E,
  PlaygroundHostServices | PlaygroundRequestServices
>;

export type PlaygroundRequestRunner = <A, E>(
  effect: PlaygroundCallbackEffect<A, E>,
) => Promise<A>;

export interface PlaygroundRequestCallbacksShape {
  readonly runPromise: PlaygroundRequestRunner;
}

export class PlaygroundRequestCallbacks extends Context.Service<
  PlaygroundRequestCallbacks,
  PlaygroundRequestCallbacksShape
>()("@sketchi/playground/PlaygroundRequestCallbacks") {}

type PlaygroundHttpError =
  CodeModeHttpRequestError | McpTransportError | RequestBodyReadError;
type PlaygroundRequestResult<A, E> =
  | A
  | (unknown extends E
      ? Response
      : E extends PlaygroundHttpError
        ? Response
        : never);

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
  const program = Effect.gen(function* () {
    const ids = yield* PlaygroundIds;
    const callbackFibers = yield* PlaygroundCallbackFibers;
    const url = new URL(boundary.request.url);
    const traceId =
      correlationIdHeader(boundary.request, "x-sketchi-trace-id") ??
      ids.create("trace");
    const requestRoute = normalizedRequestRoute(url.pathname);
    const requestAnnotations = {
      "request.method": boundary.request.method,
      "request.route": requestRoute,
    };
    const correlation = { traceId };

    yield* Effect.annotateCurrentSpan({
      ...requestAnnotations,
      "sketchi.trace_id": traceId,
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
        (callbackProgram) =>
          withTelemetryCorrelation(callbackProgram, correlation),
      );
    const runDeferredEffect: PlaygroundRequestRunner = (callbackEffect) =>
      runTrackedEffect(
        withRequestContext(callbackEffect, "playground.request.deferred"),
      );
    const runRequestEffect: PlaygroundRequestRunner = (callbackEffect) =>
      runTrackedEffect(
        withRequestContext(callbackEffect, "playground.request.callback"),
        { signal: boundary.request.signal },
      );
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
    const errorResponse = (
      error: PlaygroundHttpError,
      status: number,
      message: string,
    ) =>
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
    return yield* httpEffect.pipe(
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
  }).pipe(Effect.withSpan("playground.request"));

  return runtime.runPromise(program, {
    signal: boundary.request.signal,
  });
}

function normalizedRequestRoute(pathname: string): string {
  const routePatterns: ReadonlyArray<readonly [RegExp, string]> = [
    [
      /^\/api\/v1\/artifacts\/[^/]+\/patch$/,
      "/api/v1/artifacts/:artifactId/patch",
    ],
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
    run: (effect, boundary) =>
      runWithPlaygroundRuntime(runtime, effect, boundary),
  };
}

const playgroundRuntime = makePlaygroundRuntime();

export const runPlaygroundEffect = playgroundRuntime.run;
