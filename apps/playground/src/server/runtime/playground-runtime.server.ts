import "@tanstack/react-start/server-only";

import { Context, Effect, FiberSet, Layer, ManagedRuntime, pipe } from "effect";

import type { StudioEnv } from "../bindings/studio-env.server";
import { PlaygroundAiModelLive } from "../ai/playground-ai-model.server";
import { PlaygroundCodeModeLive } from "../codemode/codemode-service.server";
import { PlaygroundCodeModeUsageLive } from "../codemode/codemode-usage-events.server";
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
} from "./playground-context.server";

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

const PlaygroundCoreLive = Layer.mergeAll(
  PlaygroundClockLive,
  PlaygroundIdsLive,
  PlaygroundAiModelLive,
  PlaygroundCallbackFibersLive,
  PlaygroundCodeModeLive,
  PlaygroundCodeModeUsageLive,
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

export interface PlaygroundRuntime {
  readonly dispose: () => Promise<void>;
  readonly run: <A, E>(
    effect: PlaygroundRequestEffect<A, E>,
    boundary: PlaygroundRequestBoundary,
  ) => Promise<A>;
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
): Promise<A> {
  const program = Effect.gen(function* () {
    const ids = yield* PlaygroundIds;
    const callbackFibers = yield* PlaygroundCallbackFibers;
    const url = new URL(boundary.request.url);
    const traceId =
      boundary.request.headers.get("x-sketchi-trace-id")?.trim() ||
      ids.create("trace");

    yield* Effect.annotateCurrentSpan({
      "request.method": boundary.request.method,
      "request.path": url.pathname,
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

    return yield* effect.pipe(
      Effect.provideService(PlaygroundRequestCallbacks, {
        runPromise: runRequestEffect,
      }),
      Effect.provide(requestContext),
    );
  }).pipe(Effect.withSpan("playground.request"));

  return runtime.runPromise(program, {
    signal: boundary.request.signal,
  });
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
