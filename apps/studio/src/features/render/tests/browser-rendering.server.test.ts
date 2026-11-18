import type { Browser } from "@cloudflare/playwright";
import { launch } from "@cloudflare/playwright";
import { assert, describe, expect, it } from "@effect/vitest";
import { type CanvasSpec } from "@sketchi/drawing";
import { Cause, Clock, Duration, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { beforeEach, vi } from "vitest";

import {
	BrowserRenderPool,
	HARNESS_OPEN_TIMEOUT_MS,
	PNG_EXPORT_TIMEOUT_MS,
	type CloudflareBrowserRunBinding,
	type PngRenderRequest,
} from "../browser-render-pool.server";
import {
	BROWSER_RENDER_TIMEOUT_MS,
	createCloudflareBrowserRunArtifactRenderer,
	type CodeModePngRendererNamespace,
} from "../browser-renderer.server";
import { type PngRenderResult } from "../png-renderer-object.server";

vi.mock("@cloudflare/playwright", () => ({
	launch: vi.fn(),
}));

const browserBinding: CloudflareBrowserRunBinding = { fetch };
const transientMessage =
	"Unable to connect to browser: code: 410: message: Browser not running (state: unhealthy)";
const harnessUrl = "https://studio.test/codemode-export-harness";

/** A Browser Run session whose harness page exports "PNG" on every call. */
function mockBrowser() {
	let connected = true;
	const page = {
		goto: vi.fn(async (_url: string) => {}),
		waitForFunction: vi.fn(async () => {}),
		isClosed: vi.fn(() => false),
		evaluate: vi.fn(async (script: unknown) => (typeof script === "string" ? null : btoa("PNG"))),
	};
	const close = vi.fn(async (_options?: { reason?: string }) => {
		connected = false;
	});
	const newPage = vi.fn(async () => page);
	const browser = {
		close,
		newPage,
		isConnected: () => connected,
	} as unknown as Browser;
	return {
		browser,
		close,
		disconnect: () => {
			connected = false;
		},
		newPage,
		page,
	};
}

function request(): PngRenderRequest {
	return { harnessUrl, backgroundColor: "#ffffff", excalidraw: { elements: [] } };
}

const renderPng = (input: PngRenderRequest) =>
	Effect.gen(function* () {
		const pool = yield* BrowserRenderPool;
		return yield* pool.renderPng(input);
	});

const poolLayer = BrowserRenderPool.layer(browserBinding);

/** Wake times of the test-clock sleeps forked renders are waiting on. */
const pendingWakes: number[] = [];
const pendingWakesAt = (millis: number) => pendingWakes.filter((wake) => wake === millis).length;
/** Whether a forked render is parked on a sleep that wakes by `millis`. */
const parkedBy = (millis: number) => pendingWakes.some((wake) => wake <= millis);

/** The test clock, recording each pending sleep so a test can wait for pool state instead of wall time. */
const trackedClock = Layer.effect(
	Clock.Clock,
	TestClock.testClockWith((clock) =>
		Effect.succeed<TestClock.TestClock>({
			...clock,
			sleep: (duration) =>
				Effect.suspend(() => {
					const wake = clock.currentTimeMillisUnsafe() + Duration.toMillis(duration);
					pendingWakes.push(wake);
					return clock.sleep(duration).pipe(
						Effect.ensuring(
							Effect.sync(() => {
								pendingWakes.splice(pendingWakes.indexOf(wake), 1);
							}),
						),
					);
				}),
		}),
	),
);

const macrotask = Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** Lets forked renders run until `ready` holds; a state that never comes fails on the test timeout. */
const waitUntil = (ready: () => boolean): Effect.Effect<void> =>
	Effect.suspend(() => (ready() ? Effect.void : macrotask.pipe(Effect.andThen(waitUntil(ready)))));

/** Lets forked renders act on a clock step before a check that nothing happened, without wall time. */
const yieldTurns = Effect.replicateEffect(macrotask, 10, { discard: true });

describe("Browser Run harness page pool", () => {
	const launchMock = vi.mocked(launch);

	beforeEach(() => {
		launchMock.mockReset();
		pendingWakes.length = 0;
	});

	it.effect("bounds burst admission including transient retry attempts", () =>
		Effect.gen(function* () {
			launchMock
				.mockRejectedValueOnce(new Error(transientMessage))
				.mockRejectedValueOnce(new Error(transientMessage))
				.mockRejectedValueOnce(new Error(transientMessage))
				.mockImplementation(async () => mockBrowser().browser);

			// Independent harnesses request acquisitions without assuming pool growth timing.
			const renders = yield* Effect.forkChild(
				Effect.all(
					Array.from({ length: 3 }, (_, index) =>
						renderPng({ ...request(), harnessUrl: `${harnessUrl}?client=${index}` }),
					),
					{
						concurrency: "unbounded",
					},
				),
			);
			// Each failed launch backs off 250ms, then waits for the launch window.
			yield* waitUntil(() => pendingWakesAt(250) === 3);
			expect(launchMock).toHaveBeenCalledTimes(3);
			yield* TestClock.adjust(250);
			yield* waitUntil(() => parkedBy(1_000) || launchMock.mock.calls.length > 3);
			expect(launchMock).toHaveBeenCalledTimes(3);
			yield* TestClock.adjust(749);
			yield* yieldTurns;
			expect(launchMock).toHaveBeenCalledTimes(3);
			yield* TestClock.adjust(1);
			yield* waitUntil(() => launchMock.mock.calls.length >= 6);
			expect(launchMock).toHaveBeenCalledTimes(6);
			const rendered = yield* Fiber.join(renders);

			expect(rendered).toHaveLength(3);
		}).pipe(Effect.provide(Layer.provideMerge(poolLayer, trackedClock))),
	);

	it.effect("keeps the page and does not retry a deterministic export failure", () =>
		Effect.gen(function* () {
			const session = mockBrowser();
			session.page.evaluate
				.mockImplementationOnce(async () => null)
				.mockImplementationOnce(async () => {
					throw new Error("Excalidraw rejected the scene");
				});
			launchMock.mockResolvedValue(session.browser);

			const error = yield* Effect.flip(renderPng(request()));
			const rendered = yield* renderPng(request());

			expect(error).toMatchObject({
				_tag: "BrowserRenderingFailure",
				operation: "evaluate",
				message: "Excalidraw rejected the scene",
			});
			expect(rendered.coldStart).toBe(false);
			expect(launchMock).toHaveBeenCalledTimes(1);
			expect(session.close).not.toHaveBeenCalled();
		}).pipe(Effect.provide(poolLayer)),
	);

	it.effect("abandons a hung export without retrying it", () =>
		Effect.gen(function* () {
			const hung = mockBrowser();
			const fresh = mockBrowser();
			const exportStarted = Promise.withResolvers<void>();
			hung.page.evaluate.mockImplementation(async (script: unknown) => {
				if (typeof script === "string") return null;
				exportStarted.resolve();
				return new Promise<string>(() => {});
			});
			launchMock.mockResolvedValueOnce(hung.browser).mockResolvedValueOnce(fresh.browser);

			const fiber = yield* Effect.forkChild(Effect.flip(renderPng(request())));
			yield* Effect.promise(() => exportStarted.promise);
			yield* TestClock.adjust(PNG_EXPORT_TIMEOUT_MS);
			const error = yield* Fiber.join(fiber);
			const rendered = yield* renderPng(request());

			expect(error).toMatchObject({
				_tag: "BrowserRenderingFailure",
				operation: "evaluate",
				message: `PNG export exceeded ${PNG_EXPORT_TIMEOUT_MS}ms.`,
			});
			expect(hung.close).toHaveBeenCalledTimes(1);
			expect(new Uint8Array(rendered.png)).toEqual(new Uint8Array([80, 78, 71]));
			expect(launchMock).toHaveBeenCalledTimes(2);
		}).pipe(Effect.provide(poolLayer)),
	);

	it.effect("fails a launch that hangs past the open timeout", () =>
		Effect.gen(function* () {
			const launchStarted = Promise.withResolvers<void>();
			launchMock.mockImplementation(
				() =>
					new Promise<Browser>(() => {
						launchStarted.resolve();
					}),
			);
			const fiber = yield* Effect.forkChild(Effect.flip(renderPng(request())));
			yield* Effect.promise(() => launchStarted.promise);
			yield* TestClock.adjust(HARNESS_OPEN_TIMEOUT_MS);
			const error = yield* Fiber.join(fiber);
			expect(error).toMatchObject({
				_tag: "BrowserRenderingFailure",
				operation: "launch",
				message: `Opening the export harness exceeded ${HARNESS_OPEN_TIMEOUT_MS}ms.`,
			});
		}).pipe(Effect.provide(poolLayer)),
	);

	it.effect("stops after three transient launch failures", () =>
		Effect.gen(function* () {
			launchMock.mockRejectedValue(new Error(transientMessage));
			const fiber = yield* Effect.forkChild(Effect.flip(renderPng(request())));
			yield* TestClock.adjust(1_000);
			const error = yield* Fiber.join(fiber);
			expect(error).toMatchObject({
				_tag: "BrowserRenderingFailure",
				operation: "launch",
				message: transientMessage,
			});
			expect(launchMock).toHaveBeenCalledTimes(3);
		}).pipe(Effect.provide(poolLayer)),
	);
});

function renderInput(): {
	scene: CanvasSpec;
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

function fakeRenderers(renderPng: (request: PngRenderRequest) => Promise<PngRenderResult>) {
	const renderPngMock = vi.fn(renderPng);
	const getByName = vi.fn((_name: string) => ({ renderPng: renderPngMock }));
	const renderers: CodeModePngRendererNamespace = { getByName };
	return { getByName, renderPng: renderPngMock, renderers };
}

function restartedObjectError(): Error {
	return Object.assign(new Error("Durable Object reset because its code was updated."), {
		retryable: true,
	});
}

describe("Cloudflare Browser Run Code Mode renderer", () => {
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
