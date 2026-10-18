import "@tanstack/react-start/server-only";

import { DurableObject } from "cloudflare:workers";
import { makeWorkersTelemetryLayer } from "@sketchi/observability";
import { Effect, Layer, ManagedRuntime } from "effect";

import {
	BrowserRenderPool,
	type BrowserRenderingOperation,
	type CloudflareBrowserRunBinding,
	type PngRenderRequest,
} from "./browser-render-pool.server";

export interface CodeModePngRendererEnv {
	readonly BROWSER?: CloudflareBrowserRunBinding;
}

/** Plain data so it crosses Durable Object RPC intact. */
export type PngRenderResult =
	| { readonly _tag: "Rendered"; readonly png: ArrayBuffer; readonly coldStart: boolean }
	| {
			readonly _tag: "Failed";
			readonly message: string;
			readonly operation: BrowserRenderingOperation;
	  };

const PngRendererTelemetryLive = makeWorkersTelemetryLayer({
	resource: { serviceName: "sketchi-playground-png-renderer" },
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

	async renderPng(request: PngRenderRequest): Promise<PngRenderResult> {
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
					onSuccess: ({ coldStart, png }): PngRenderResult => ({
						_tag: "Rendered",
						coldStart,
						png,
					}),
				}),
			),
		);
	}

	/**
	 * Starts opening a harness page and returns at once. A failure is recorded
	 * on the prewarm span; the next export opens its own page.
	 */
	prewarm(harnessUrl: string): void {
		this.#rendererRuntime()?.runFork(
			Effect.gen(function* () {
				const pool = yield* BrowserRenderPool;
				yield* pool.prewarm(harnessUrl);
			}).pipe(Effect.ignore),
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
