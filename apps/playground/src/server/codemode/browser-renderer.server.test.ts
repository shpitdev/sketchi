import type { Browser } from "@cloudflare/playwright";
import { launch } from "@cloudflare/playwright";
import { assert, describe, it } from "@effect/vitest";
import {
	makeTelemetryTestSink,
	makeWorkersTelemetryLayer,
	type TelemetryMetricEvent,
	type TelemetryLogEvent,
	type TelemetrySpanEvent,
} from "@sketchi/observability";
import { Cause, Clock, Effect, Exit, Fiber } from "effect";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { TestClock } from "effect/testing";
import { beforeEach, expect, vi } from "vitest";

import {
	BROWSER_RENDER_TIMEOUT_MS,
	createCloudflareBrowserRunArtifactRenderer,
	withScopedBrowserSession,
	type CloudflareBrowserRunBinding,
} from "./browser-renderer.server";

vi.mock("@cloudflare/playwright", () => ({
	launch: vi.fn(),
}));

const browserBinding: CloudflareBrowserRunBinding = { fetch };
const transientMessage =
	"Unable to connect to browser: code: 410: message: Browser not running (state: unhealthy)";

function mockBrowser() {
	const page = {
		goto: vi.fn(async () => {}),
		waitForFunction: vi.fn(async () => {}),
		evaluate: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(btoa("PNG")),
	};
	const close = vi.fn(async () => {});
	const newPage = vi.fn(async () => page);
	return { browser: { close, newPage } as unknown as Browser, close, newPage, page };
}

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

describe("Cloudflare Browser Rendering Code Mode renderer", () => {
	const launchMock = vi.mocked(launch);

	beforeEach(() => {
		launchMock.mockReset();
	});

	it.effect("retries an unhealthy launch with backoff and retry telemetry", () => {
		const { probe, sink } = makeTelemetryTestSink();
		return Effect.gen(function* () {
			const { browser, close } = mockBrowser();
			launchMock.mockRejectedValueOnce(new Error(transientMessage)).mockResolvedValue(browser);
			const renderer = createCloudflareBrowserRunArtifactRenderer(browserBinding);
			const fiber = yield* Effect.forkChild(renderer.renderPng(renderInput()));
			yield* TestClock.adjust(249);
			expect(launchMock).toHaveBeenCalledTimes(1);
			yield* TestClock.adjust(1);
			const png = yield* Fiber.join(fiber);
			expect(new Uint8Array(png)).toEqual(new Uint8Array([80, 78, 71]));
			expect(launchMock).toHaveBeenCalledTimes(2);
			expect(close).toHaveBeenCalledTimes(1);
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
				makeWorkersTelemetryLayer({ resource: { serviceName: "sketchi-browser-test" }, sink }),
			),
		);
	});

	it.effect("does not retry a non-transient launch failure", () =>
		Effect.gen(function* () {
			launchMock.mockRejectedValue(new Error("Invalid browser binding"));
			const renderer = createCloudflareBrowserRunArtifactRenderer(browserBinding);
			const error = yield* Effect.flip(renderer.renderPng(renderInput()));
			expect(error).toMatchObject({ _tag: "BrowserRenderingFailure", operation: "launch" });
			expect(launchMock).toHaveBeenCalledTimes(1);
		}),
	);

	it.effect("surfaces the third transient failure after 250ms and 750ms backoffs", () =>
		Effect.gen(function* () {
			launchMock.mockRejectedValue(new Error(transientMessage));
			const renderer = createCloudflareBrowserRunArtifactRenderer(browserBinding);
			const fiber = yield* Effect.forkChild(Effect.flip(renderer.renderPng(renderInput())));
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
		}),
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
				const renderer = createCloudflareBrowserRunArtifactRenderer(browserBinding);
				const fiber = yield* Effect.forkChild(renderer.renderPng(renderInput()));
				yield* TestClock.adjust(250);
				yield* Fiber.join(fiber);
				expect(launchMock).toHaveBeenCalledTimes(2);
				expect(second.close).toHaveBeenCalledTimes(1);
			}),
		);
	}

	for (const operation of ["evaluate", "base64", "timeout"] as const) {
		it.effect(`does not retry a deterministic ${operation} failure`, () =>
			Effect.gen(function* () {
				const { browser, close, page } = mockBrowser();
				if (operation === "evaluate") page.evaluate.mockReset().mockResolvedValue(transientMessage);
				if (operation === "base64")
					page.evaluate.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce("%");
				if (operation === "timeout")
					page.waitForFunction.mockRejectedValue(
						Object.assign(new Error("WebSocket timed out"), { name: "TimeoutError" }),
					);
				launchMock.mockResolvedValue(browser);
				const renderer = createCloudflareBrowserRunArtifactRenderer(browserBinding);
				const error = yield* Effect.flip(renderer.renderPng(renderInput()));
				expect(error).toMatchObject({
					_tag: "BrowserRenderingFailure",
					operation: operation === "timeout" ? "waitForHarness" : operation,
				});
				expect(launchMock).toHaveBeenCalledTimes(1);
				expect(close).toHaveBeenCalledTimes(1);
			}),
		);
	}

	for (const end of ["timeout", "interruption"] as const) {
		it.effect(`closes a retried session on ${end} without resetting the deadline`, () =>
			Effect.gen(function* () {
				const { browser, close, page } = mockBrowser();
				const waitStarted = Promise.withResolvers<void>();
				page.waitForFunction.mockImplementation(
					() => new Promise<void>(() => waitStarted.resolve()),
				);
				launchMock.mockRejectedValueOnce(new Error(transientMessage)).mockResolvedValue(browser);
				const renderer = createCloudflareBrowserRunArtifactRenderer(browserBinding);
				const startedAt = yield* Clock.currentTimeMillis;
				const fiber = yield* Effect.forkChild(renderer.renderPng(renderInput()));
				yield* TestClock.adjust(250);
				yield* Effect.promise(() => waitStarted.promise);
				if (end === "timeout") {
					yield* TestClock.adjust(BROWSER_RENDER_TIMEOUT_MS - 250);
				} else {
					yield* Fiber.interrupt(fiber);
				}
				const exit = yield* Fiber.await(fiber);
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					if (end === "timeout") {
						const failure = Cause.findError(exit.cause);
						expect(failure).toMatchObject({
							_tag: "Success",
							success: { _tag: "BrowserRenderingTimeout" },
						});
						expect((yield* Clock.currentTimeMillis) - startedAt).toBe(BROWSER_RENDER_TIMEOUT_MS);
					} else {
						assert.isTrue(Cause.hasInterrupts(exit.cause));
					}
				}
				expect(launchMock).toHaveBeenCalledTimes(2);
				expect(close).toHaveBeenCalledTimes(1);
				expect(close).toHaveBeenCalledWith({ reason: "Code Mode PNG render interrupted" });
			}),
		);
	}

	it.effect("interruption during backoff does not launch another session", () =>
		Effect.gen(function* () {
			const { browser, close, page } = mockBrowser();
			page.goto.mockRejectedValue(new Error(transientMessage));
			launchMock.mockResolvedValue(browser);
			const renderer = createCloudflareBrowserRunArtifactRenderer(browserBinding);
			const fiber = yield* Effect.forkChild(renderer.renderPng(renderInput()));
			yield* TestClock.adjust(249);
			expect(close).toHaveBeenCalledTimes(1);
			yield* Fiber.interrupt(fiber);
			yield* TestClock.adjust(1_000);
			expect(launchMock).toHaveBeenCalledTimes(1);
		}),
	);

	it.effect("renders through the harness with boundary telemetry", () => {
		const { probe, sink } = makeTelemetryTestSink();
		const telemetryLayer = makeWorkersTelemetryLayer({
			resource: { serviceName: "sketchi-browser-test" },
			sink,
		});
		return Effect.gen(function* () {
			let visitedUrl = "";
			const close = vi.fn(async () => {});
			const page = {
				goto: vi.fn(async (value: string) => {
					visitedUrl = value;
				}),
				waitForFunction: vi.fn(async () => {}),
				evaluate: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(btoa("PNG")),
			};
			launchMock.mockResolvedValue({
				close,
				newPage: vi.fn(async () => page),
			} as unknown as Browser);

			const renderer = createCloudflareBrowserRunArtifactRenderer(browserBinding, {
				assetOrigin: "https://studio.test",
			});
			const png = yield* renderer.renderPng(renderInput());

			expect(visitedUrl).toBe("https://studio.test/codemode-export-harness");
			expect(new Uint8Array(png)).toEqual(new Uint8Array([80, 78, 71]));
			expect(close).toHaveBeenCalledTimes(1);
			const spans = probe.events.filter(
				(event): event is TelemetrySpanEvent => event.event === "effect.span",
			);
			const metrics = probe.events.filter(
				(event): event is TelemetryMetricEvent => event.event === "effect.metric",
			);
			assert.isTrue(
				spans.some(
					(span) =>
						span.name === "playground.browserRendering.goto" &&
						span.attributes["operation"] === "goto",
				),
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
		}).pipe(Effect.provide(telemetryLayer));
	});

	it.effect("closes on a typed page failure", () =>
		Effect.gen(function* () {
			const close = vi.fn(async () => {});
			launchMock.mockResolvedValue({
				close,
				newPage: vi.fn(async () => {
					throw new Error("new page failed");
				}),
			} as unknown as Browser);

			const renderer = createCloudflareBrowserRunArtifactRenderer(browserBinding);
			const error = yield* Effect.flip(renderer.renderPng(renderInput()));

			assert.strictEqual(error._tag, "BrowserRenderingFailure");
			if (error._tag === "BrowserRenderingFailure") {
				assert.strictEqual(error.operation, "newPage");
			}
			expect(close).toHaveBeenCalledTimes(1);
		}),
	);

	it.effect("closes when scoped use defects", () =>
		Effect.gen(function* () {
			const close = vi.fn(async () => {});
			const browser = { close } as unknown as Browser;
			const exit = yield* Effect.exit(
				withScopedBrowserSession(Effect.succeed(browser), () =>
					Effect.die(new Error("render defect")),
				),
			);

			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				assert.isTrue(Cause.hasDies(exit.cause));
			}
			expect(close).toHaveBeenCalledTimes(1);
		}),
	);

	it.effect("times out with a typed failure and closes promptly", () =>
		Effect.gen(function* () {
			const waitStarted = Promise.withResolvers<void>();
			const close = vi.fn(async () => {});
			const page = {
				goto: vi.fn(async () => {}),
				waitForFunction: vi.fn(
					() =>
						new Promise<void>(() => {
							waitStarted.resolve();
						}),
				),
				evaluate: vi.fn(),
			};
			launchMock.mockResolvedValue({
				close,
				newPage: vi.fn(async () => page),
			} as unknown as Browser);
			const renderer = createCloudflareBrowserRunArtifactRenderer(browserBinding);
			const fiber = yield* Effect.forkChild(renderer.renderPng(renderInput()));
			yield* Effect.promise(() => waitStarted.promise);
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
			expect(close).toHaveBeenCalledTimes(1);
		}),
	);

	it.effect("closes and releases the scope on interruption", () =>
		Effect.gen(function* () {
			const waitStarted = Promise.withResolvers<void>();
			const close = vi.fn(async () => {});
			const page = {
				goto: vi.fn(async () => {}),
				waitForFunction: vi.fn(
					() =>
						new Promise<void>(() => {
							waitStarted.resolve();
						}),
				),
				evaluate: vi.fn(),
			};
			launchMock.mockResolvedValue({
				close,
				newPage: vi.fn(async () => page),
			} as unknown as Browser);
			const renderer = createCloudflareBrowserRunArtifactRenderer(browserBinding);
			const fiber = yield* Effect.forkChild(renderer.renderPng(renderInput()));
			yield* Effect.promise(() => waitStarted.promise);
			yield* Fiber.interrupt(fiber);
			const exit = yield* Fiber.await(fiber);

			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				assert.isTrue(Cause.hasInterrupts(exit.cause));
			}
			expect(close).toHaveBeenCalledWith({
				reason: "Code Mode PNG render interrupted",
			});
		}),
	);
});
