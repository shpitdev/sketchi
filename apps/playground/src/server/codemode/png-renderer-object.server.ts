import "@tanstack/react-start/server-only";

import { DurableObject } from "cloudflare:workers";
import {
	makeWorkersTelemetryLayer,
	type TelemetryPipeline,
	withTelemetryCorrelation,
	withTelemetryExport,
} from "@sketchi/observability";
import { Effect, Layer, ManagedRuntime, Tracer } from "effect";

import type { IconImagingResult } from "@sketchi/icon-draw";

import {
	BrowserRenderPool,
	type BrowserRenderingOperation,
	type CloudflareBrowserRunBinding,
	type IconJobRequest,
	type PngRenderCaller,
	type PngRenderRequest,
	type PngRenderTiming,
} from "./browser-render-pool.server";

export interface CodeModePngRendererEnv {
	readonly BROWSER?: CloudflareBrowserRunBinding;
	readonly TELEMETRY_SPANS?: TelemetryPipeline;
}

/** Plain data so it crosses Durable Object RPC intact. */
export type PngRenderResult =
	| {
			readonly _tag: "Rendered";
			readonly png: ArrayBuffer;
			readonly coldStart: boolean;
			readonly timing: PngRenderTiming;
	  }
	| {
			readonly _tag: "Failed";
			readonly message: string;
			readonly operation: BrowserRenderingOperation;
	  };

/** Plain data so it crosses Durable Object RPC intact. */
export type IconJobResult =
	| { readonly _tag: "Done"; readonly result: IconImagingResult }
	| {
			readonly _tag: "Failed";
			readonly message: string;
			readonly operation: BrowserRenderingOperation;
	  };

const PngRendererTelemetryLive = makeWorkersTelemetryLayer({
	resource: { serviceName: "sketchi-studio-png-renderer" },
});

function makeRendererRuntime(binding: CloudflareBrowserRunBinding) {
	return ManagedRuntime.make(
		BrowserRenderPool.layer(binding).pipe(Layer.provideMerge(PngRendererTelemetryLive)),
	);
}

/**
 * Exports Code Mode PNGs from warm Browser Run pages. A Worker request cannot
 * keep a browser connection for the next request; a Durable Object can, so
 * exports after the first skip the browser launch and the harness load.
 */
export class CodeModePngRenderer extends DurableObject<CodeModePngRendererEnv> {
	#runtime: ReturnType<typeof makeRendererRuntime> | undefined;

	async renderPng(request: PngRenderRequest, caller?: PngRenderCaller): Promise<PngRenderResult> {
		const runtime = this.#rendererRuntime();
		if (!runtime) {
			return {
				_tag: "Failed",
				message: "The Browser Run binding is not configured.",
				operation: "launch",
			};
		}

		return runtime.runPromise(
			Effect.gen(function* () {
				const pool = yield* BrowserRenderPool;
				return yield* pool.renderPng(request);
			}).pipe(
				Effect.match({
					onFailure: (error): PngRenderResult => ({
						_tag: "Failed",
						message: error.message,
						operation: error.operation,
					}),
					onSuccess: ({ coldStart, png, timing }): PngRenderResult => ({
						_tag: "Rendered",
						coldStart,
						png,
						timing,
					}),
				}),
				this.#exportSpans("playground.pngRenderer.renderPng", caller),
			),
		);
	}

	/** Prepares logos and exports icon scenes for the icon draw service. */
	async runIconJob(request: IconJobRequest, caller?: PngRenderCaller): Promise<IconJobResult> {
		const runtime = this.#rendererRuntime();
		if (!runtime) {
			return {
				_tag: "Failed",
				message: "The Browser Run binding is not configured.",
				operation: "launch",
			};
		}
		return runtime.runPromise(
			Effect.gen(function* () {
				const pool = yield* BrowserRenderPool;
				return yield* pool.runIconJob(request);
			}).pipe(
				Effect.match({
					onFailure: (error): IconJobResult => ({
						_tag: "Failed",
						message: error.message,
						operation: error.operation,
					}),
					onSuccess: (result): IconJobResult => ({ _tag: "Done", result }),
				}),
				this.#exportSpans("playground.pngRenderer.iconJob", caller),
			),
		);
	}

	/**
	 * Starts opening a harness page and returns at once. A failure is recorded
	 * on the prewarm span; the next export opens its own page.
	 */
	prewarm(harnessUrl: string, caller?: PngRenderCaller): void {
		this.#rendererRuntime()?.runFork(
			Effect.gen(function* () {
				const pool = yield* BrowserRenderPool;
				yield* pool.prewarm(harnessUrl);
			}).pipe(Effect.ignore, this.#exportSpans("playground.pngRenderer.prewarm", caller)),
		);
	}

	/**
	 * Roots one call's spans under the caller's span, with the caller's ray, run and
	 * attempt IDs, and sends them when the call ends.
	 */
	#exportSpans(name: string, caller: PngRenderCaller | undefined) {
		const target = {
			pipeline: this.env.TELEMETRY_SPANS,
			waitUntil: (promise: Promise<unknown>) => this.ctx.waitUntil(promise),
		};
		return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			withTelemetryCorrelation(
				effect.pipe(
					withTelemetryExport(target),
					Effect.withSpan(
						name,
						caller
							? { parent: Tracer.externalSpan({ spanId: caller.spanId, traceId: caller.traceId }) }
							: {},
					),
				),
				{
					...(caller?.attemptId ? { attemptId: caller.attemptId } : {}),
					...(caller?.rayId ? { rayId: caller.rayId } : {}),
					...(caller?.runId ? { runId: caller.runId } : {}),
				},
			);
	}

	#rendererRuntime() {
		const binding = this.env.BROWSER;
		if (!binding) {
			return undefined;
		}
		this.#runtime ??= makeRendererRuntime(binding);
		return this.#runtime;
	}
}
