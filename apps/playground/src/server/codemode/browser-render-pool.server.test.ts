import type { Browser } from "@cloudflare/playwright";
import { launch } from "@cloudflare/playwright";
import { describe, expect, it } from "@effect/vitest";
import {
	makeTelemetryTestSink,
	makeWorkersTelemetryLayer,
	type TelemetryLogEvent,
	type TelemetryMetricEvent,
} from "@sketchi/observability";
import { Duration, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { beforeEach, vi } from "vitest";

import {
	BrowserRenderPool,
	BROWSER_KEEP_ALIVE_MS,
	HARNESS_OPEN_TIMEOUT_MS,
	HARNESS_PAGE_IDLE_TTL,
	PNG_EXPORT_TIMEOUT_MS,
	type CloudflareBrowserRunBinding,
	type PngRenderRequest,
} from "./browser-render-pool.server";

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

const prewarm = Effect.gen(function* () {
	const pool = yield* BrowserRenderPool;
	yield* pool.prewarm(harnessUrl);
});

const poolLayer = BrowserRenderPool.layer(browserBinding);

describe("Browser Run harness page pool", () => {
	const launchMock = vi.mocked(launch);

	beforeEach(() => {
		launchMock.mockReset();
	});

	it.effect("reuses one warm harness page across exports", () =>
		Effect.gen(function* () {
			const session = mockBrowser();
			launchMock.mockResolvedValue(session.browser);

			const first = yield* renderPng(request());
			const second = yield* renderPng(request());

			expect(new Uint8Array(first.png)).toEqual(new Uint8Array([80, 78, 71]));
			expect(first.coldStart).toBe(true);
			expect(second.coldStart).toBe(false);
			expect(launchMock).toHaveBeenCalledTimes(1);
			expect(launchMock).toHaveBeenCalledWith(expect.anything(), {
				keep_alive: BROWSER_KEEP_ALIVE_MS,
			});
			expect(session.page.goto).toHaveBeenCalledTimes(1);
			expect(session.page.goto).toHaveBeenCalledWith(harnessUrl, {
				waitUntil: "domcontentloaded",
			});
			expect(session.close).not.toHaveBeenCalled();
		}).pipe(Effect.provide(poolLayer)),
	);

	it.effect("opens a second page while the first is exporting", () =>
		Effect.gen(function* () {
			const first = mockBrowser();
			const second = mockBrowser();
			const exportStarted = Promise.withResolvers<void>();
			const finishExport = Promise.withResolvers<string>();
			first.page.evaluate.mockImplementation(async (script: unknown) => {
				if (typeof script === "string") return null;
				exportStarted.resolve();
				return finishExport.promise;
			});
			launchMock.mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);

			const slow = yield* Effect.forkChild(renderPng(request()));
			yield* Effect.promise(() => exportStarted.promise);
			const fast = yield* renderPng(request());
			finishExport.resolve(btoa("PNG"));
			yield* Fiber.join(slow);

			expect(fast.coldStart).toBe(true);
			expect(launchMock).toHaveBeenCalledTimes(2);
		}).pipe(Effect.provide(poolLayer)),
	);

	it.effect("replaces a page whose Browser Run session closed while idle", () =>
		Effect.gen(function* () {
			const stale = mockBrowser();
			const fresh = mockBrowser();
			launchMock.mockResolvedValueOnce(stale.browser).mockResolvedValueOnce(fresh.browser);

			yield* renderPng(request());
			stale.disconnect();
			const rendered = yield* renderPng(request());

			expect(rendered.coldStart).toBe(true);
			expect(launchMock).toHaveBeenCalledTimes(2);
			expect(stale.close).toHaveBeenCalledTimes(1);
			expect(fresh.page.evaluate).toHaveBeenCalledTimes(2);
		}).pipe(Effect.provide(poolLayer)),
	);

	it.effect("retries on a fresh page when the session drops mid-export", () =>
		Effect.gen(function* () {
			const dropped = mockBrowser();
			const fresh = mockBrowser();
			dropped.page.evaluate.mockImplementation(async (script: unknown) => {
				if (typeof script === "string") return null;
				dropped.disconnect();
				throw new Error("Target page, context or browser has been closed");
			});
			launchMock.mockResolvedValueOnce(dropped.browser).mockResolvedValueOnce(fresh.browser);

			const rendered = yield* renderPng(request());

			expect(new Uint8Array(rendered.png)).toEqual(new Uint8Array([80, 78, 71]));
			expect(launchMock).toHaveBeenCalledTimes(2);
			expect(dropped.close).toHaveBeenCalledTimes(1);
		}).pipe(Effect.provide(poolLayer)),
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

	it.effect("prewarms a page that the next export finds warm", () =>
		Effect.gen(function* () {
			const session = mockBrowser();
			launchMock.mockResolvedValue(session.browser);

			yield* prewarm;
			const rendered = yield* renderPng(request());

			expect(rendered.coldStart).toBe(false);
			expect(launchMock).toHaveBeenCalledTimes(1);
			expect(session.page.goto).toHaveBeenCalledWith(harnessUrl, {
				waitUntil: "domcontentloaded",
			});
		}).pipe(Effect.provide(poolLayer)),
	);

	it.effect("does not prewarm a pool that already has a page", () =>
		Effect.gen(function* () {
			const session = mockBrowser();
			launchMock.mockResolvedValue(session.browser);

			yield* renderPng(request());
			yield* prewarm;

			expect(launchMock).toHaveBeenCalledTimes(1);
		}).pipe(Effect.provide(poolLayer)),
	);

	it.effect("opens one page for concurrent prewarms and an export already opening one", () =>
		Effect.gen(function* () {
			const session = mockBrowser();
			const launchStarted = Promise.withResolvers<void>();
			const finishLaunch = Promise.withResolvers<Browser>();
			launchMock.mockImplementation(() => {
				launchStarted.resolve();
				return finishLaunch.promise;
			});

			const exportFiber = yield* Effect.forkChild(renderPng(request()));
			yield* Effect.promise(() => launchStarted.promise);
			const prewarms = yield* Effect.forkChild(
				Effect.all([prewarm, prewarm], { concurrency: "unbounded" }),
			);
			finishLaunch.resolve(session.browser);
			yield* Fiber.join(prewarms);
			const rendered = yield* Fiber.join(exportFiber);

			expect(rendered.coldStart).toBe(true);
			expect(launchMock).toHaveBeenCalledTimes(1);
		}).pipe(Effect.provide(poolLayer)),
	);

	it.effect("opens a single page when prewarms arrive together", () =>
		Effect.gen(function* () {
			const session = mockBrowser();
			launchMock.mockResolvedValue(session.browser);

			yield* Effect.all([prewarm, prewarm, prewarm], { concurrency: "unbounded" });

			expect(launchMock).toHaveBeenCalledTimes(1);
		}).pipe(Effect.provide(poolLayer)),
	);

	it.effect("closes an idle page within two idle periods", () =>
		Effect.gen(function* () {
			const session = mockBrowser();
			launchMock.mockResolvedValue(session.browser);

			yield* renderPng(request());
			yield* TestClock.adjust(Duration.times(HARNESS_PAGE_IDLE_TTL, 2));

			expect(session.close).toHaveBeenCalledTimes(1);
		}).pipe(Effect.provide(poolLayer)),
	);

	it.effect("closes every page when the pool shuts down", () =>
		Effect.gen(function* () {
			const session = mockBrowser();
			launchMock.mockResolvedValue(session.browser);

			yield* renderPng(request()).pipe(Effect.provide(poolLayer));

			expect(session.close).toHaveBeenCalledTimes(1);
		}),
	);

	it.effect("retries an unhealthy launch with backoff and retry telemetry", () => {
		const { probe, sink } = makeTelemetryTestSink();
		return Effect.gen(function* () {
			const session = mockBrowser();
			launchMock
				.mockRejectedValueOnce(new Error(transientMessage))
				.mockResolvedValue(session.browser);
			const fiber = yield* Effect.forkChild(renderPng(request()));
			yield* TestClock.adjust(249);
			expect(launchMock).toHaveBeenCalledTimes(1);
			yield* TestClock.adjust(1);
			const rendered = yield* Fiber.join(fiber);

			expect(new Uint8Array(rendered.png)).toEqual(new Uint8Array([80, 78, 71]));
			expect(launchMock).toHaveBeenCalledTimes(2);
			const retries = probe.events.filter(
				(event): event is TelemetryMetricEvent =>
					event.event === "effect.metric" && event.metric === "sketchi_browser_rendering_retries",
			);
			expect(retries).toHaveLength(1);
			expect(retries[0]).toMatchObject({
				value: 1,
				attributes: { operation: "launch", failure_category: "BrowserRenderingFailure" },
			});
			const warnings = probe.events.filter(
				(event): event is TelemetryLogEvent =>
					event.event === "effect.log" && event.level === "Warn",
			);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toMatchObject({
				message: "Retrying Browser Rendering session",
				fields: { operation: "launch", failure_category: "BrowserRenderingFailure", attempt: 1 },
			});
		}).pipe(
			Effect.provide(
				poolLayer.pipe(
					Layer.provideMerge(
						makeWorkersTelemetryLayer({ resource: { serviceName: "sketchi-browser-test" }, sink }),
					),
				),
			),
		);
	});

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

	it.effect("does not retry a non-transient launch failure", () =>
		Effect.gen(function* () {
			launchMock.mockRejectedValue(new Error("Invalid browser binding"));
			const error = yield* Effect.flip(renderPng(request()));
			expect(error).toMatchObject({ _tag: "BrowserRenderingFailure", operation: "launch" });
			expect(launchMock).toHaveBeenCalledTimes(1);
		}).pipe(Effect.provide(poolLayer)),
	);

	it.effect("surfaces the third transient failure after 250ms and 750ms backoffs", () =>
		Effect.gen(function* () {
			launchMock.mockRejectedValue(new Error(transientMessage));
			const fiber = yield* Effect.forkChild(Effect.flip(renderPng(request())));
			yield* TestClock.adjust(250);
			expect(launchMock).toHaveBeenCalledTimes(2);
			yield* TestClock.adjust(749);
			expect(launchMock).toHaveBeenCalledTimes(2);
			yield* TestClock.adjust(1);
			const error = yield* Fiber.join(fiber);
			expect(error).toMatchObject({
				_tag: "BrowserRenderingFailure",
				operation: "launch",
				message: transientMessage,
			});
			expect(launchMock).toHaveBeenCalledTimes(3);
		}).pipe(Effect.provide(poolLayer)),
	);

	for (const operation of ["newPage", "goto", "waitForHarness"] as const) {
		it.effect(`closes the failed ${operation} session before launching a fresh browser`, () =>
			Effect.gen(function* () {
				const first = mockBrowser();
				const second = mockBrowser();
				const failing =
					operation === "newPage"
						? first.newPage
						: operation === "goto"
							? first.page.goto
							: first.page.waitForFunction;
				failing.mockRejectedValueOnce(new Error("WebSocket connection closed"));
				launchMock.mockResolvedValueOnce(first.browser).mockImplementationOnce(async () => {
					expect(first.close).toHaveBeenCalledTimes(1);
					return second.browser;
				});
				const fiber = yield* Effect.forkChild(renderPng(request()));
				yield* TestClock.adjust(250);
				yield* Fiber.join(fiber);
				expect(launchMock).toHaveBeenCalledTimes(2);
			}).pipe(Effect.provide(poolLayer)),
		);
	}

	it.effect("fails without retrying when the harness reports a load error", () =>
		Effect.gen(function* () {
			const session = mockBrowser();
			session.page.evaluate.mockResolvedValue("Excalidraw failed to load");
			launchMock.mockResolvedValue(session.browser);
			const error = yield* Effect.flip(renderPng(request()));
			expect(error).toMatchObject({
				_tag: "BrowserRenderingFailure",
				operation: "evaluate",
				message: "Excalidraw failed to load",
			});
			expect(launchMock).toHaveBeenCalledTimes(1);
			expect(session.close).toHaveBeenCalledTimes(1);
		}).pipe(Effect.provide(poolLayer)),
	);

	it.effect("does not retry a malformed export payload", () =>
		Effect.gen(function* () {
			const session = mockBrowser();
			session.page.evaluate.mockImplementation(async (script: unknown) =>
				typeof script === "string" ? null : "%",
			);
			launchMock.mockResolvedValue(session.browser);
			const error = yield* Effect.flip(renderPng(request()));
			expect(error).toMatchObject({ _tag: "BrowserRenderingFailure", operation: "base64" });
			expect(launchMock).toHaveBeenCalledTimes(1);
		}).pipe(Effect.provide(poolLayer)),
	);
});
