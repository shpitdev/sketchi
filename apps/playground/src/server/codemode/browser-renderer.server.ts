import "@tanstack/react-start/server-only";

import type { CodeModeArtifactRenderer } from "@sketchi/diagram-agent";
import { recordMetric } from "@sketchi/observability";
import { Clock, Context, Effect, Layer, Metric, Schema } from "effect";

import {
	BrowserRenderingFailure,
	browserFailure,
	browserRenderingRetrySchedule,
	type PngRenderRequest,
} from "./browser-render-pool.server";
import type { PngRenderResult } from "./png-renderer-object.server";

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

export class BrowserRenderingTimeout extends Schema.TaggedError<BrowserRenderingTimeout>()(
	"BrowserRenderingTimeout",
	{
		durationMs: Schema.Number,
		message: Schema.String,
	},
) {}

/** The `CODEMODE_PNG_RENDERER` Durable Object namespace, narrowed to what the Worker calls. */
export interface CodeModePngRendererNamespace {
	getByName(name: string): {
		renderPng(request: PngRenderRequest): Promise<PngRenderResult>;
		prewarm(harnessUrl: string): Promise<void> | void;
	};
}

export interface CloudflareBrowserRunRendererOptions {
	assetOrigin?: string;
}

export interface CloudflareBrowserRunArtifactRenderer extends CodeModeArtifactRenderer {
	readonly renderPng: (
		input: Parameters<CodeModeArtifactRenderer["renderPng"]>[0],
	) => Effect.Effect<ArrayBuffer | Uint8Array, BrowserRenderingFailure | BrowserRenderingTimeout>;
	/** Asks the renderer to open a harness page if it has none. Failures only reach telemetry. */
	readonly prewarm: Effect.Effect<void>;
}

export interface PlaygroundBrowserRenderingShape {
	readonly renderer: (
		renderers: CodeModePngRendererNamespace,
		options?: CloudflareBrowserRunRendererOptions,
	) => CloudflareBrowserRunArtifactRenderer;
}

export class PlaygroundBrowserRendering extends Context.Service<
	PlaygroundBrowserRendering,
	PlaygroundBrowserRenderingShape
>()("@sketchi/playground/PlaygroundBrowserRendering") {}

export const PlaygroundBrowserRenderingLive = Layer.succeed(PlaygroundBrowserRendering, {
	renderer: createCloudflareBrowserRunArtifactRenderer,
});

/**
 * Renders through the `CodeModePngRenderer` Durable Object for the harness
 * URL, which keeps warm Browser Run pages between requests.
 */
export function createCloudflareBrowserRunArtifactRenderer(
	renderers: CodeModePngRendererNamespace,
	options: CloudflareBrowserRunRendererOptions = {},
): CloudflareBrowserRunArtifactRenderer {
	const harnessUrl = new URL(HARNESS_PATH, options.assetOrigin ?? DEFAULT_ASSET_ORIGIN).toString();

	return {
		prewarm: Effect.tryPromise({
			try: async () => renderers.getByName(harnessUrl).prewarm(harnessUrl),
			catch: browserFailure("durableObject"),
		}).pipe(
			Effect.withSpan("playground.browserRendering.prewarm"),
			Effect.annotateSpans({ operation: "prewarm" }),
			Effect.ignore,
		),
		renderPng: Effect.fn("playground.browserRendering.renderPng")((input) => {
			const render = Effect.tryPromise({
				try: () =>
					renderers.getByName(harnessUrl).renderPng({
						harnessUrl,
						backgroundColor: input.scene.backgroundColor,
						excalidraw: input.excalidraw,
					}),
				catch: browserFailure("durableObject"),
			}).pipe(
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
				Effect.timeout(BROWSER_RENDER_TIMEOUT_MS),
				Effect.catchTag("TimeoutError", () =>
					Effect.fail(
						BrowserRenderingTimeout.make({
							durationMs: BROWSER_RENDER_TIMEOUT_MS,
							message: `Browser Rendering exceeded ${BROWSER_RENDER_TIMEOUT_MS}ms.`,
						}),
					),
				),
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
