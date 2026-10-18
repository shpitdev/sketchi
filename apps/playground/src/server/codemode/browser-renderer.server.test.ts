import { assert, describe, expect, it } from "@effect/vitest";
import {
	makeTelemetryTestSink,
	makeWorkersTelemetryLayer,
	type TelemetryMetricEvent,
	type TelemetrySpanEvent,
} from "@sketchi/observability";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { Cause, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";

import type { PngRenderRequest } from "./browser-render-pool.server";
import {
	BROWSER_RENDER_TIMEOUT_MS,
	createCloudflareBrowserRunArtifactRenderer,
	type CodeModePngRendererNamespace,
} from "./browser-renderer.server";
import type { PngRenderResult } from "./png-renderer-object.server";

function renderInput(): {
	scene: RenderedDiagramScene;
	excalidraw: { appState: Record<string, unknown>; elements: never[] };
} {
	return {
		scene: {
			kind: "canvas",
			version: 1,
			accentColor: "#000000",
			backgroundColor: "#ffffff",
			diagramId: "test-diagram",
			elements: [],
			layers: [],
			layouts: [],
			height: 120,
			title: "Test diagram",
			width: 180,
			zOrder: [],
		},
		excalidraw: {
			appState: {},
			elements: [],
		},
	};
}

function rendered(coldStart = false): PngRenderResult {
	return { _tag: "Rendered", coldStart, png: new Uint8Array([80, 78, 71]).buffer };
}

function fakeRenderers(renderPng: (request: PngRenderRequest) => Promise<PngRenderResult>) {
	const renderPngMock = vi.fn(renderPng);
	const prewarm = vi.fn((_harnessUrl: string) => {});
	const getByName = vi.fn((_name: string) => ({ renderPng: renderPngMock, prewarm }));
	const renderers: CodeModePngRendererNamespace = { getByName };
	return { getByName, prewarm, renderPng: renderPngMock, renderers };
}

function restartedObjectError(): Error {
	return Object.assign(new Error("Durable Object reset because its code was updated."), {
		retryable: true,
	});
}

describe("Cloudflare Browser Run Code Mode renderer", () => {
	it.effect("renders through the Durable Object for the harness URL with telemetry", () => {
		const { probe, sink } = makeTelemetryTestSink();
		return Effect.gen(function* () {
			const { getByName, renderPng, renderers } = fakeRenderers(async () => rendered(true));
			const renderer = createCloudflareBrowserRunArtifactRenderer(renderers, {
				assetOrigin: "https://studio.test",
			});
			const input = renderInput();

			const png = yield* renderer.renderPng(input);

			expect(new Uint8Array(png)).toEqual(new Uint8Array([80, 78, 71]));
			expect(getByName).toHaveBeenCalledWith("https://studio.test/codemode-export-harness");
			expect(renderPng).toHaveBeenCalledWith({
				harnessUrl: "https://studio.test/codemode-export-harness",
				backgroundColor: "#ffffff",
				excalidraw: input.excalidraw,
			});
			const span = probe.events.find(
				(event): event is TelemetrySpanEvent =>
					event.event === "effect.span" && event.name === "playground.browserRendering.renderPng",
			);
			expect(span?.attributes["cache_mode"]).toBe("cold");
			const metrics = probe.events.filter(
				(event): event is TelemetryMetricEvent => event.event === "effect.metric",
			);
			assert.deepInclude(
				metrics.find((metric) => metric.metric === "sketchi_browser_rendering_requests")
					?.attributes,
				{
					operation: "renderPng",
					outcome: "success",
					surface: "browser_rendering",
				},
			);
		}).pipe(
			Effect.provide(
				makeWorkersTelemetryLayer({ resource: { serviceName: "sketchi-browser-test" }, sink }),
			),
		);
	});

	it.effect("defaults the harness to the public product host", () =>
		Effect.gen(function* () {
			const { getByName, renderers } = fakeRenderers(async () => rendered());
			yield* createCloudflareBrowserRunArtifactRenderer(renderers).renderPng(renderInput());
			expect(getByName).toHaveBeenCalledWith(
				"https://playground.sketchi.app/codemode-export-harness",
			);
		}),
	);

	it.effect("maps a failed render to a typed failure without retrying", () =>
		Effect.gen(function* () {
			const { renderPng, renderers } = fakeRenderers(async () => ({
				_tag: "Failed",
				message: "Browser not running (state: unhealthy)",
				operation: "launch",
			}));
			const error = yield* Effect.flip(
				createCloudflareBrowserRunArtifactRenderer(renderers).renderPng(renderInput()),
			);
			expect(error).toMatchObject({
				_tag: "BrowserRenderingFailure",
				operation: "launch",
				message: "Browser not running (state: unhealthy)",
			});
			expect(renderPng).toHaveBeenCalledTimes(1);
		}),
	);

	it.effect("retries a call interrupted by a Durable Object restart", () =>
		Effect.gen(function* () {
			const { renderPng, renderers } = fakeRenderers(async () => rendered());
			renderPng.mockRejectedValueOnce(restartedObjectError());
			const fiber = yield* Effect.forkChild(
				createCloudflareBrowserRunArtifactRenderer(renderers).renderPng(renderInput()),
			);
			yield* TestClock.adjust(250);
			const png = yield* Fiber.join(fiber);
			expect(new Uint8Array(png)).toEqual(new Uint8Array([80, 78, 71]));
			expect(renderPng).toHaveBeenCalledTimes(2);
		}),
	);

	it.effect("does not retry an overloaded Durable Object", () =>
		Effect.gen(function* () {
			const { renderPng, renderers } = fakeRenderers(async () => {
				throw Object.assign(restartedObjectError(), { overloaded: true });
			});
			const error = yield* Effect.flip(
				createCloudflareBrowserRunArtifactRenderer(renderers).renderPng(renderInput()),
			);
			expect(error).toMatchObject({ _tag: "BrowserRenderingFailure", operation: "durableObject" });
			expect(renderPng).toHaveBeenCalledTimes(1);
		}),
	);

	it.effect("prewarms the Durable Object for the harness URL", () =>
		Effect.gen(function* () {
			const { getByName, prewarm, renderers } = fakeRenderers(async () => rendered());
			yield* createCloudflareBrowserRunArtifactRenderer(renderers, {
				assetOrigin: "https://studio.test",
			}).prewarm;
			expect(getByName).toHaveBeenCalledWith("https://studio.test/codemode-export-harness");
			expect(prewarm).toHaveBeenCalledWith("https://studio.test/codemode-export-harness");
		}),
	);

	it.effect("keeps a failed prewarm out of the caller's error channel", () =>
		Effect.gen(function* () {
			const { prewarm, renderers } = fakeRenderers(async () => rendered());
			prewarm.mockImplementation(() => {
				throw new Error("Durable Object overloaded");
			});
			const exit = yield* Effect.exit(
				createCloudflareBrowserRunArtifactRenderer(renderers).prewarm,
			);
			assert.isTrue(Exit.isSuccess(exit));
		}),
	);

	it.effect("times out with a typed failure", () =>
		Effect.gen(function* () {
			const callStarted = Promise.withResolvers<void>();
			const { renderers } = fakeRenderers(
				() =>
					new Promise<PngRenderResult>(() => {
						callStarted.resolve();
					}),
			);
			const fiber = yield* Effect.forkChild(
				createCloudflareBrowserRunArtifactRenderer(renderers).renderPng(renderInput()),
			);
			yield* Effect.promise(() => callStarted.promise);
			yield* TestClock.adjust(BROWSER_RENDER_TIMEOUT_MS);
			const exit = yield* Fiber.await(fiber);

			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				const failure = Cause.findError(exit.cause);
				assert.isTrue(failure._tag === "Success");
				if (failure._tag === "Success") {
					assert.strictEqual(failure.success._tag, "BrowserRenderingTimeout");
				}
			}
		}),
	);
});
