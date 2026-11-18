import "@tanstack/react-start/server-only";

import { Clock, Context, Effect, Layer } from "effect";

import type { StudioEnv } from "./studio-env.server";

export interface StudioRequestMetadataShape {
	/** From `x-sketchi-attempt-id`, or created when the request started. */
	readonly attemptId: string;
	readonly method: string;
	readonly origin: string;
	readonly path: string;
	readonly request: Request;
	/** From `x-sketchi-run-id`, or created when the request started. */
	readonly runId: string;
	readonly traceId: string;
}

export class StudioBindings extends Context.Service<StudioBindings, StudioEnv>()(
	"@sketchi/studio/PlaygroundBindings",
) {}

export class StudioRequestMetadata extends Context.Service<
	StudioRequestMetadata,
	StudioRequestMetadataShape
>()("@sketchi/studio/PlaygroundRequestMetadata") {}

export interface StudioPlatformCallbacksShape {
	readonly waitUntil: (effect: Effect.Effect<void, never, StudioRequestServices>) => void;
	readonly waitUntilPromise: (promise: Promise<unknown>) => void;
}

export interface StudioPlatformBoundaryShape {
	readonly waitUntilPromise: (promise: Promise<unknown>) => void;
}

export class StudioPlatformCallbacks extends Context.Service<
	StudioPlatformCallbacks,
	StudioPlatformCallbacksShape
>()("@sketchi/studio/PlaygroundPlatformCallbacks") {}

export interface StudioIdsShape {
	readonly create: (prefix: string) => string;
}

export class StudioIds extends Context.Service<StudioIds, StudioIdsShape>()(
	"@sketchi/studio/PlaygroundIds",
) {}

export const StudioIdsLive = Layer.succeed(StudioIds, {
	create: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`,
});

export interface StudioClockShape {
	readonly nowMillis: Effect.Effect<number>;
	readonly nowIso: Effect.Effect<string>;
}

export class StudioClock extends Context.Service<StudioClock, StudioClockShape>()(
	"@sketchi/studio/PlaygroundClock",
) {}

export const StudioClockLive = Layer.succeed(StudioClock, {
	nowMillis: Clock.currentTimeMillis,
	nowIso: Clock.currentTimeMillis.pipe(Effect.map((millis) => new Date(millis).toISOString())),
});

export type StudioRequestServices =
	| StudioBindings
	| StudioPlatformCallbacks
	| StudioRequestMetadata;
