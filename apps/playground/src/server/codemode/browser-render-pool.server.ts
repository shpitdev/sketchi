import "@tanstack/react-start/server-only";

import type { Browser, BrowserWorker, Page } from "@cloudflare/playwright";
import { recordMetric } from "@sketchi/observability";
import {
	Cause,
	Context,
	Duration,
	Effect,
	Exit,
	Layer,
	Metric,
	Pool,
	Predicate,
	RcMap,
	Schedule,
	Schema,
} from "effect";

export type CloudflareBrowserRunBinding = BrowserWorker;

/**
 * A warm harness page closes after this long without an export. The pool checks
 * once per period, so retirement takes between one and two periods.
 */
export const HARNESS_PAGE_IDLE_TTL = Duration.seconds(60);
/**
 * Browser Run closes a session after this long without CDP traffic. It outlasts
 * pool retirement, and bounds a browser left behind when the Durable Object
 * restarts.
 */
export const BROWSER_KEEP_ALIVE_MS = 150_000;
/** Browser Run admits three new browsers per second per account. */
export const MAX_HARNESS_PAGES = 4;
export const HARNESS_OPEN_TIMEOUT_MS = 45_000;
export const PNG_EXPORT_TIMEOUT_MS = 30_000;
const EXPORT_SCALE = 2;
const EXPORT_PADDING = 20;

const browserRenderingRetries = Metric.counter("sketchi_browser_rendering_retries", {
	description: "Browser Rendering transient session retries",
	incremental: true,
});

const BrowserRenderingOperationSchema = Schema.Literals([
	"base64",
	"durableObject",
	"evaluate",
	"goto",
	"launch",
	"newPage",
	"waitForHarness",
]);

export type BrowserRenderingOperation = typeof BrowserRenderingOperationSchema.Type;

export class BrowserRenderingFailure extends Schema.TaggedError<BrowserRenderingFailure>()(
	"BrowserRenderingFailure",
	{
		cause: Schema.Defect(),
		message: Schema.String,
		operation: BrowserRenderingOperationSchema,
	},
) {}

export function browserFailure(operation: BrowserRenderingOperation) {
	return (cause: unknown) =>
		BrowserRenderingFailure.make({
			cause,
			message: cause instanceof Error ? cause.message : "Browser Rendering failed.",
			operation,
		});
}

/** Durable Object RPC marks a failure retryable when the object restarted mid-call. */
function isRetryableDurableObjectError(cause: unknown): boolean {
	return (
		Predicate.hasProperty(cause, "retryable") &&
		cause.retryable === true &&
		!(Predicate.hasProperty(cause, "overloaded") && cause.overloaded === true)
	);
}

function isTransientSessionFailure(error: BrowserRenderingFailure): boolean {
	if (error.operation === "durableObject") {
		return isRetryableDurableObjectError(error.cause);
	}
	return (
		error.operation !== "evaluate" &&
		error.operation !== "base64" &&
		!(error.cause instanceof Error && error.cause.name === "TimeoutError") &&
		!/timeout|timed out/i.test(error.message) &&
		/Browser not running|unhealthy|code: 410|code: 429|code: 5\d\d|Unable to connect|WebSocket/i.test(
			error.message,
		)
	);
}

export const browserRenderingRetrySchedule = Schedule.exponential(250, 3).pipe(
	Schedule.upTo({ times: 2 }),
	Schedule.setInputType<BrowserRenderingFailure>(),
	Schedule.while(({ input }) => isTransientSessionFailure(input)),
	Schedule.tap(({ input: error, attempt }) =>
		Effect.gen(function* () {
			yield* recordMetric(browserRenderingRetries, 1, {
				operation: error.operation,
				failureCategory: error._tag,
				surface: "browser_rendering",
			});
			yield* Effect.logWarning("Retrying Browser Rendering session", {
				attempt,
				operation: error.operation,
				failure_category: error._tag,
			});
		}),
	),
);

function tryBrowserPromise<A>(
	operation: Exclude<BrowserRenderingOperation, "base64" | "durableObject">,
	run: (signal: AbortSignal) => Promise<A>,
) {
	return Effect.tryPromise({
		try: run,
		catch: browserFailure(operation),
	}).pipe(
		Effect.withSpan(`playground.browserRendering.${operation}`),
		Effect.annotateSpans({ operation }),
	);
}

function closeBrowser(browser: Browser, exit: Exit.Exit<unknown, unknown>): Effect.Effect<void> {
	const interrupted = Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause);
	return Effect.tryPromise({
		try: () =>
			browser.close(interrupted ? { reason: "Code Mode PNG render interrupted" } : undefined),
		catch: (cause) => cause,
	}).pipe(
		Effect.catch((cause) =>
			Effect.logWarning("Browser Rendering session cleanup failed", {
				error_tag: cause instanceof Error ? cause.name : "BrowserCleanupFailure",
				operation: "close",
			}),
		),
		Effect.asVoid,
	);
}

/** A Browser Run page with the export harness loaded and ready to export. */
interface HarnessPage {
	readonly browser: Browser;
	readonly page: Page;
	/** Pool sequence number taken when the page finished opening. */
	openedAt: number;
	/** Set when an export hung, so the page is not reused. */
	abandoned: boolean;
}

function isLive(harness: HarnessPage): boolean {
	return !harness.abandoned && harness.browser.isConnected() && !harness.page.isClosed();
}

const prepareHarnessPage = Effect.fnUntraced(function* (browser: Browser, harnessUrl: string) {
	const page = yield* tryBrowserPromise("newPage", () => browser.newPage());
	yield* tryBrowserPromise("goto", () => page.goto(harnessUrl, { waitUntil: "domcontentloaded" }));
	yield* tryBrowserPromise("waitForHarness", () =>
		page.waitForFunction(
			"window.sketchiExportReady === true || Boolean(window.sketchiExportError)",
		),
	);

	const harnessError = yield* tryBrowserPromise("evaluate", () =>
		page.evaluate("window.sketchiExportError || null"),
	);
	if (typeof harnessError === "string" && harnessError.length > 0) {
		return yield* BrowserRenderingFailure.make({
			cause: new Error(harnessError),
			message: harnessError,
			operation: "evaluate",
		});
	}
	return page;
});

/** One launch attempt; a browser that fails to prepare closes before any retry. */
const launchHarnessPage = Effect.fnUntraced(function* (
	binding: CloudflareBrowserRunBinding,
	harnessUrl: string,
) {
	const browser = yield* tryBrowserPromise("launch", async (signal) => {
		const { launch } = await import("@cloudflare/playwright");
		return launch(browserBindingWithSignal(binding, signal), {
			keep_alive: BROWSER_KEEP_ALIVE_MS,
		});
	});
	const page = yield* prepareHarnessPage(browser, harnessUrl).pipe(
		Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : closeBrowser(browser, exit))),
	);
	return { browser, page, openedAt: 0, abandoned: false } satisfies HarnessPage;
});

function openHarnessPage(binding: CloudflareBrowserRunBinding, harnessUrl: string) {
	return Effect.acquireRelease(
		launchHarnessPage(binding, harnessUrl).pipe(
			Effect.retry(browserRenderingRetrySchedule),
			// Waiting renders queue behind this page, so a stuck launch must end.
			Effect.timeoutOrElse({
				duration: HARNESS_OPEN_TIMEOUT_MS,
				orElse: () =>
					Effect.fail(
						BrowserRenderingFailure.make({
							cause: new Error("Harness page open timed out"),
							message: `Opening the export harness exceeded ${HARNESS_OPEN_TIMEOUT_MS}ms.`,
							operation: "launch",
						}),
					),
			}),
		),
		(harness, exit) => closeBrowser(harness.browser, exit),
		{ interruptible: true },
	).pipe(Effect.withSpan("playground.browserRendering.openHarnessPage"));
}

export interface PngRenderRequest {
	readonly harnessUrl: string;
	readonly backgroundColor: string;
	readonly excalidraw: unknown;
}

export interface RenderedPng {
	readonly png: ArrayBuffer;
	/** True when this export waited for a page to open rather than finding one ready. */
	readonly coldStart: boolean;
}

const exportHarnessPng = Effect.fnUntraced(function* (
	harness: HarnessPage,
	request: PngRenderRequest,
) {
	const pngBase64 = yield* tryBrowserPromise("evaluate", () =>
		harness.page.evaluate(
			async ({ backgroundColor, excalidraw, padding, scale }) => {
				const exportHarness = globalThis as unknown as {
					sketchiExportPng: (
						scene: unknown,
						exportOptions: {
							backgroundColor: string;
							padding: number;
							scale: number;
						},
					) => Promise<string>;
				};

				return exportHarness.sketchiExportPng(excalidraw, {
					backgroundColor,
					padding,
					scale,
				});
			},
			{
				backgroundColor: request.backgroundColor,
				excalidraw: request.excalidraw,
				padding: EXPORT_PADDING,
				scale: EXPORT_SCALE,
			},
		),
	).pipe(
		Effect.timeoutOrElse({
			duration: PNG_EXPORT_TIMEOUT_MS,
			orElse: () =>
				Effect.suspend(() => {
					harness.abandoned = true;
					return Effect.fail(
						BrowserRenderingFailure.make({
							cause: new Error("PNG export timed out"),
							message: `PNG export exceeded ${PNG_EXPORT_TIMEOUT_MS}ms.`,
							operation: "evaluate",
						}),
					);
				}),
		}),
	);

	return yield* Effect.try({
		try: () => base64ToArrayBuffer(pngBase64),
		catch: browserFailure("base64"),
	}).pipe(
		Effect.withSpan("playground.browserRendering.base64"),
		Effect.annotateSpans({ operation: "base64" }),
	);
});

class StaleHarnessPage extends Schema.TaggedError<StaleHarnessPage>()("StaleHarnessPage", {
	cause: Schema.Defect(),
}) {}

export interface BrowserRenderPoolShape {
	readonly renderPng: (
		request: PngRenderRequest,
	) => Effect.Effect<RenderedPng, BrowserRenderingFailure>;
	/**
	 * Opens one harness page when none is open or opening, so the first export
	 * of a session finds it ready. It never adds a page to a pool in use.
	 */
	readonly prewarm: (harnessUrl: string) => Effect.Effect<void, BrowserRenderingFailure>;
}

/**
 * Keeps Browser Run pages with the export harness loaded, per harness URL, so
 * an export skips the browser launch and the Excalidraw load. Pages grow on
 * demand up to MAX_HARNESS_PAGES and close after HARNESS_PAGE_IDLE_TTL idle.
 */
export class BrowserRenderPool extends Context.Service<BrowserRenderPool, BrowserRenderPoolShape>()(
	"@sketchi/playground/BrowserRenderPool",
) {
	static readonly layer = (binding: CloudflareBrowserRunBinding) =>
		Layer.effect(
			BrowserRenderPool,
			Effect.gen(function* () {
				// Orders page openings against render requests to tell warm from cold.
				let sequence = 0;
				// Pages open or opening per harness URL, and prewarms in flight.
				const pageCounts = new Map<string, number>();
				const prewarming = new Set<string>();
				const countPages = (harnessUrl: string, delta: number) =>
					Effect.sync(() => {
						pageCounts.set(harnessUrl, (pageCounts.get(harnessUrl) ?? 0) + delta);
					});

				const pagesByHarness = yield* RcMap.make({
					lookup: (harnessUrl: string) =>
						Pool.makeWithTTL({
							acquire: Effect.acquireRelease(countPages(harnessUrl, 1), () =>
								countPages(harnessUrl, -1),
							).pipe(
								Effect.andThen(openHarnessPage(binding, harnessUrl)),
								Effect.tap((harness) =>
									Effect.sync(() => {
										harness.openedAt = ++sequence;
									}),
								),
							),
							min: 0,
							max: MAX_HARNESS_PAGES,
							timeToLive: HARNESS_PAGE_IDLE_TTL,
						}),
					idleTimeToLive: Duration.infinity,
				});

				const renderOnce = (request: PngRenderRequest) =>
					Effect.scoped(
						Effect.gen(function* () {
							const requestedAt = ++sequence;
							const pages = yield* RcMap.get(pagesByHarness, request.harnessUrl);
							const harness = yield* Pool.get(pages);
							// Browser Run may have closed an idle session; replace it.
							if (!isLive(harness)) {
								yield* Pool.invalidate(pages, harness);
								return yield* new StaleHarnessPage({ cause: new Error("Browser Run page closed") });
							}
							const coldStart = harness.openedAt > requestedAt;
							const png = yield* exportHarnessPng(harness, request).pipe(
								Effect.catch(
									(error): Effect.Effect<never, BrowserRenderingFailure | StaleHarnessPage> => {
										if (isLive(harness)) {
											return Effect.fail(error);
										}
										// A hung export is not retried; a closed session is.
										const failure = harness.abandoned
											? error
											: new StaleHarnessPage({ cause: error });
										return Pool.invalidate(pages, harness).pipe(
											Effect.andThen(Effect.fail(failure)),
										);
									},
								),
							);
							return { png, coldStart } satisfies RenderedPng;
						}),
					);

				return BrowserRenderPool.of({
					renderPng: Effect.fn("playground.browserRendering.renderPool")(function* (request) {
						return yield* renderOnce(request).pipe(
							Effect.retry({
								times: 2,
								while: (error) => error._tag === "StaleHarnessPage",
							}),
							Effect.catchTag("StaleHarnessPage", (error) =>
								Effect.fail(browserFailure("evaluate")(error.cause)),
							),
						);
					}),
					prewarm: Effect.fn("playground.browserRendering.prewarm")(function* (harnessUrl) {
						if (prewarming.has(harnessUrl) || (pageCounts.get(harnessUrl) ?? 0) > 0) {
							return;
						}
						prewarming.add(harnessUrl);
						yield* Effect.scoped(
							RcMap.get(pagesByHarness, harnessUrl).pipe(Effect.flatMap(Pool.get)),
						).pipe(Effect.ensuring(Effect.sync(() => prewarming.delete(harnessUrl))));
					}),
				});
			}),
		);
}

function browserBindingWithSignal(
	browserBinding: CloudflareBrowserRunBinding,
	signal: AbortSignal,
): CloudflareBrowserRunBinding {
	return {
		fetch: (request, init) =>
			browserBinding.fetch(request, {
				...init,
				signal,
			}),
	};
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
	const binary = atob(value);
	const buffer = new ArrayBuffer(binary.length);
	const bytes = new Uint8Array(buffer);

	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}

	return buffer;
}
