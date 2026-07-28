import "@tanstack/react-start/server-only";

import { Clock, Context, Effect, Layer } from "effect";

import type { StudioEnv } from "../bindings/studio-env.server";

export interface PlaygroundRequestMetadataShape {
  readonly method: string;
  readonly origin: string;
  readonly path: string;
  readonly request: Request;
  readonly traceId: string;
}

export class PlaygroundBindings extends Context.Service<
  PlaygroundBindings,
  StudioEnv
>()("@sketchi/playground/PlaygroundBindings") {}

export class PlaygroundRequestMetadata extends Context.Service<
  PlaygroundRequestMetadata,
  PlaygroundRequestMetadataShape
>()("@sketchi/playground/PlaygroundRequestMetadata") {}

export interface PlaygroundPlatformCallbacksShape {
  readonly waitUntil: (
    effect: Effect.Effect<void, never, PlaygroundRequestServices>,
  ) => void;
  readonly waitUntilPromise: (promise: Promise<unknown>) => void;
}

export interface PlaygroundPlatformBoundaryShape {
  readonly waitUntilPromise: (promise: Promise<unknown>) => void;
}

export class PlaygroundPlatformCallbacks extends Context.Service<
  PlaygroundPlatformCallbacks,
  PlaygroundPlatformCallbacksShape
>()("@sketchi/playground/PlaygroundPlatformCallbacks") {}

export interface PlaygroundIdsShape {
  readonly create: (prefix: string) => string;
}

export class PlaygroundIds extends Context.Service<
  PlaygroundIds,
  PlaygroundIdsShape
>()("@sketchi/playground/PlaygroundIds") {}

export const PlaygroundIdsLive = Layer.succeed(PlaygroundIds, {
  create: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`,
});

export interface PlaygroundClockShape {
  readonly nowMillis: Effect.Effect<number>;
  readonly nowIso: Effect.Effect<string>;
}

export class PlaygroundClock extends Context.Service<
  PlaygroundClock,
  PlaygroundClockShape
>()("@sketchi/playground/PlaygroundClock") {}

export const PlaygroundClockLive = Layer.succeed(PlaygroundClock, {
  nowMillis: Clock.currentTimeMillis,
  nowIso: Clock.currentTimeMillis.pipe(
    Effect.map((millis) => new Date(millis).toISOString()),
  ),
});

export type PlaygroundRequestServices =
  | PlaygroundBindings
  | PlaygroundPlatformCallbacks
  | PlaygroundRequestMetadata;
