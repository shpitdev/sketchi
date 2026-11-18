import "@tanstack/react-start/server-only";

import type { ArtifactRenderer } from "@sketchi/diagrams/build";
import { recordMetric, TelemetryCorrelation } from "@sketchi/observability";
import { Clock, Context, Effect, Layer, Metric, Option, Schema } from "effect";

import {
	BrowserRenderingFailure,
	browserFailure,
	browserRenderingRetrySchedule,
	type IconJobRequest,
	type PngRenderCaller,
	type PngRenderRequest,
} from "./browser-render-pool.server";
import type { IconJobResult, PngRenderResult } from "./png-renderer-object.server";

export const BROWSER_RENDER_TIMEOUT_MS = 60_000;
/**
 * Browser Rendering loads the export harness over the public internet, so this
 * fallback origin must be the public product host rather than the Worker
 * hostname that currently serves it.
 */
export const DEFAULT_ASSET_ORIGIN = "https://playground.sketchi.app";
const HARNESS_PATH = "/codemode-export-harness";

const browserRenderingRequests = Metric.counter("sketchi_browser_rendering_requests", {
	description: "Browser Rendering requests by terminal outcome",
	incremental: true,
});
const browserRenderingFailures = Metric.counter("sketchi_browser_rendering_failures", {
	description: "Browser Rendering typed failures",
	incremental: true,
});
const browserRenderingTimeouts = Metric.counter("sketchi_browser_rendering_timeouts", {
	description: "Browser Rendering timeouts",
	incremental: true,
});
const browserRenderingDuration = Metric.histogram("sketchi_browser_rendering_duration_ms", {
	description: "Browser Rendering duration in milliseconds",
	boundaries: Metric.boundariesFromIterable([
		50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000,
	]),
});

export class BrowserRenderingTimeout extends Schema.TaggedError<
	BrowserRenderingTimeout,
	{ readonly brand: unique symbol }
>()("BrowserRenderingTimeout", {
	durationMs: Schema.Number,
	message: Schema.String,
}) {}

/** The `CODEMODE_PNG_RENDERER` Durable Object namespace, narrowed to what the Worker calls. */
export interface CodeModePngRendererNamespace {
	getByName(name: string): {
		renderPng(request: PngRenderRequest, caller?: PngRenderCaller): Promise<PngRenderResult>;
		/** The icon draw service's raster work; a stub in tests that do not draw icons may omit it. */
		runIconJob?(request: IconJobRequest, caller?: PngRenderCaller): Promise<IconJobResult>;
	};
}

export interface CloudflareBrowserRunRendererOptions {
	assetOrigin?: string;
}

export interface CloudflareBrowserRunArtifactRenderer extends ArtifactRenderer {
	readonly renderPng: (
		input: Parameters<ArtifactRenderer["renderPng"]>[0],
	) => Effect.Effect<ArrayBuffer | Uint8Array, BrowserRenderingFailure | BrowserRenderingTimeout>;
}

export interface StudioBrowserRenderingShape {
	readonly renderer: (
		renderers: CodeModePngRendererNamespace,
		options?: CloudflareBrowserRunRendererOptions,
	) => CloudflareBrowserRunArtifactRenderer;
}

export class StudioBrowserRendering extends Context.Service<
	StudioBrowserRendering,
	StudioBrowserRenderingShape
>()("@sketchi/studio/PlaygroundBrowserRendering") {}

export const StudioBrowserRenderingLive = Layer.succeed(StudioBrowserRendering, {
	renderer: createCloudflareBrowserRunArtifactRenderer,
});

/** The export harness page Browser Rendering loads. */
export function browserRunHarnessUrl(options: CloudflareBrowserRunRendererOptions = {}): string {
	return new URL(HARNESS_PATH, options.assetOrigin ?? DEFAULT_ASSET_ORIGIN).toString();
}

/** The caller's span and request IDs, so the renderer's spans join the caller's trace. */
export const browserRunCaller = Effect.gen(function* () {
	const span = Option.getOrUndefined(yield* Effect.option(Effect.currentSpan));
	if (!span) return undefined;
	const { attemptId, rayId, runId } = yield* TelemetryCorrelation;
	return {
		...(attemptId ? { attemptId } : {}),
		...(rayId ? { rayId } : {}),
		...(runId ? { runId } : {}),
		spanId: span.spanId,
		traceId: span.traceId,
	} satisfies PngRenderCaller;
});

/**
 * Renders through the `CodeModePngRenderer` Durable Object for the harness
 * URL, which keeps warm Browser Run pages between requests.
 */
export function createCloudflareBrowserRunArtifactRenderer(
	renderers: CodeModePngRendererNamespace,
	options: CloudflareBrowserRunRendererOptions = {},
): CloudflareBrowserRunArtifactRenderer {
	const harnessUrl = browserRunHarnessUrl(options);
	const caller = browserRunCaller;

	return {
		renderPng: Effect.fn("playground.browserRendering.renderPng")((input) => {
			const render = Effect.flatMap(caller, (parent) =>
				Effect.tryPromise({
					try: () =>
						renderers.getByName(harnessUrl).renderPng(
							{
								harnessUrl,
								backgroundColor: input.scene.backgroundColor,
								excalidraw: input.excalidraw,
							},
							parent,
						),
					catch: browserFailure("durableObject"),
				}),
			).pipe(
				Effect.retry(browserRenderingRetrySchedule),
				Effect.flatMap((result) =>
					result._tag === "Rendered"
						? Effect.succeed(result)
						: Effect.fail(
								BrowserRenderingFailure.make({
									cause: new Error(result.message),
									message: result.message,
									operation: result.operation,
								}),
							),
				),
				Effect.tap((result) =>
					Effect.annotateCurrentSpan({
						cache_mode: result.coldStart ? "cold" : "warm",
						queue_ms: result.timing.queueMs,
						open_ms: result.timing.openMs,
						export_ms: result.timing.exportMs,
					}),
				),
				Effect.map((result) => result.png),
				Effect.timeoutOrElse({
					duration: BROWSER_RENDER_TIMEOUT_MS,
					orElse: () =>
						Effect.fail(
							BrowserRenderingTimeout.make({
								durationMs: BROWSER_RENDER_TIMEOUT_MS,
								message: `Browser Rendering exceeded ${BROWSER_RENDER_TIMEOUT_MS}ms.`,
							}),
						),
				}),
			);

			return Effect.gen(function* () {
				const startedAt = yield* Clock.currentTimeMillis;
				return yield* render.pipe(
					Effect.tap(() =>
						Effect.gen(function* () {
							const finishedAt = yield* Clock.currentTimeMillis;
							yield* recordMetric(browserRenderingRequests, 1, {
								operation: "renderPng",
								outcome: "success",
								surface: "browser_rendering",
							});
							yield* recordMetric(browserRenderingDuration, finishedAt - startedAt, {
								operation: "renderPng",
								outcome: "success",
								surface: "browser_rendering",
							});
						}),
					),
					Effect.tapError((error) =>
						Effect.gen(function* () {
							const finishedAt = yield* Clock.currentTimeMillis;
							yield* recordMetric(browserRenderingRequests, 1, {
								failureCategory: error._tag,
								operation: "renderPng",
								outcome: "failure",
								surface: "browser_rendering",
							});
							yield* recordMetric(browserRenderingFailures, 1, {
								failureCategory: error._tag,
								operation: "renderPng",
								surface: "browser_rendering",
							});
							yield* recordMetric(browserRenderingDuration, finishedAt - startedAt, {
								failureCategory: error._tag,
								operation: "renderPng",
								outcome: "failure",
								surface: "browser_rendering",
							});
							if (error._tag === "BrowserRenderingTimeout") {
								yield* recordMetric(browserRenderingTimeouts, 1, {
									operation: "renderPng",
									surface: "browser_rendering",
									timeoutKind: "render",
								});
							}
						}),
					),
				);
			});
		}),
	};
}
