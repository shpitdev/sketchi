import "@tanstack/react-start/server-only";

import type { Browser, BrowserWorker } from "@cloudflare/playwright";
import type { CodeModeArtifactRenderer } from "@sketchi/diagram-agent";
import { recordMetric } from "@sketchi/observability";
import {
  Cause,
  Clock,
  Context,
  Effect,
  Exit,
  Layer,
  Metric,
  Schema,
} from "effect";

export type CloudflareBrowserRunBinding = BrowserWorker;

export const BROWSER_RENDER_TIMEOUT_MS = 60_000;
const EXPORT_SCALE = 2;
const EXPORT_PADDING = 20;
/**
 * Browser Rendering loads the export harness over the public internet, so this
 * fallback origin must be the public product host rather than the Worker
 * hostname that currently serves it.
 */
export const DEFAULT_ASSET_ORIGIN = "https://playground.sketchi.app";
const HARNESS_PATH = "/codemode-export-harness";

const browserRenderingRequests = Metric.counter(
  "sketchi_browser_rendering_requests",
  {
    description: "Browser Rendering requests by terminal outcome",
    incremental: true,
  },
);
const browserRenderingFailures = Metric.counter(
  "sketchi_browser_rendering_failures",
  {
    description: "Browser Rendering typed failures",
    incremental: true,
  },
);
const browserRenderingTimeouts = Metric.counter(
  "sketchi_browser_rendering_timeouts",
  {
    description: "Browser Rendering timeouts",
    incremental: true,
  },
);
const browserRenderingDuration = Metric.histogram(
  "sketchi_browser_rendering_duration_ms",
  {
    description: "Browser Rendering duration in milliseconds",
    boundaries: Metric.boundariesFromIterable([
      50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000,
    ]),
  },
);

const BrowserRenderingOperationSchema = Schema.Literals([
  "base64",
  "evaluate",
  "goto",
  "launch",
  "newPage",
  "waitForHarness",
]);

export class BrowserRenderingFailure extends Schema.TaggedErrorClass<BrowserRenderingFailure>()(
  "BrowserRenderingFailure",
  {
    cause: Schema.Defect(),
    message: Schema.String,
    operation: BrowserRenderingOperationSchema,
  },
) {}

export class BrowserRenderingTimeout extends Schema.TaggedErrorClass<BrowserRenderingTimeout>()(
  "BrowserRenderingTimeout",
  {
    durationMs: Schema.Number,
    message: Schema.String,
  },
) {}

export interface CloudflareBrowserRunRendererOptions {
  assetOrigin?: string;
}

export interface CloudflareBrowserRunArtifactRenderer
  extends CodeModeArtifactRenderer {
  readonly renderPng: (
    input: Parameters<CodeModeArtifactRenderer["renderPng"]>[0],
  ) => Effect.Effect<
    ArrayBuffer | Uint8Array,
    BrowserRenderingFailure | BrowserRenderingTimeout
  >;
}

export interface PlaygroundBrowserRenderingShape {
  readonly renderer: (
    binding: CloudflareBrowserRunBinding,
    options?: CloudflareBrowserRunRendererOptions,
  ) => CloudflareBrowserRunArtifactRenderer;
}

export class PlaygroundBrowserRendering extends Context.Service<
  PlaygroundBrowserRendering,
  PlaygroundBrowserRenderingShape
>()("@sketchi/playground/PlaygroundBrowserRendering") {}

export const PlaygroundBrowserRenderingLive = Layer.succeed(
  PlaygroundBrowserRendering,
  { renderer: createCloudflareBrowserRunArtifactRenderer },
);

type BrowserRenderingOperation =
  | "base64"
  | "evaluate"
  | "goto"
  | "launch"
  | "newPage"
  | "waitForHarness";

function browserFailure(operation: BrowserRenderingOperation) {
  return (cause: unknown) =>
    BrowserRenderingFailure.make({
      cause,
      message:
        cause instanceof Error ? cause.message : "Browser Rendering failed.",
      operation,
    });
}

function tryBrowserPromise<A>(
  operation: Exclude<BrowserRenderingOperation, "base64">,
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

function closeBrowser(
  browser: Browser,
  exit: Exit.Exit<unknown, unknown>,
): Effect.Effect<void> {
  const interrupted = Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause);
  return Effect.tryPromise({
    try: () =>
      browser.close(
        interrupted
          ? { reason: "Code Mode PNG render interrupted" }
          : undefined,
      ),
    catch: (cause) => cause,
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Browser Rendering session cleanup failed", {
        error_tag:
          cause instanceof Error ? cause.name : "BrowserCleanupFailure",
        operation: "close",
      }),
    ),
    Effect.asVoid,
  );
}

export function withScopedBrowserSession<A, E>(
  acquire: Effect.Effect<Browser, BrowserRenderingFailure>,
  use: (browser: Browser) => Effect.Effect<A, E>,
): Effect.Effect<A, E | BrowserRenderingFailure> {
  return Effect.scoped(
    Effect.gen(function* () {
      const browser = yield* Effect.acquireRelease(acquire, closeBrowser, {
        interruptible: true,
      });
      return yield* use(browser);
    }),
  );
}

export function createCloudflareBrowserRunArtifactRenderer(
  browserBinding: CloudflareBrowserRunBinding,
  options: CloudflareBrowserRunRendererOptions = {},
): CloudflareBrowserRunArtifactRenderer {
  const harnessUrl = new URL(
    HARNESS_PATH,
    options.assetOrigin ?? DEFAULT_ASSET_ORIGIN,
  ).toString();

  return {
    renderPng: Effect.fn("playground.browserRendering.renderPng")((input) => {
      const render = withScopedBrowserSession(
        tryBrowserPromise("launch", async (signal) => {
          const { launch } = await import("@cloudflare/playwright");
          return launch(browserBindingWithSignal(browserBinding, signal), {
            keep_alive: 10_000,
          });
        }),
        (browser) =>
          Effect.gen(function* () {
            const page = yield* tryBrowserPromise("newPage", () =>
              browser.newPage(),
            );
            yield* tryBrowserPromise("goto", () =>
              page.goto(harnessUrl, { waitUntil: "domcontentloaded" }),
            );
            yield* tryBrowserPromise("waitForHarness", () =>
              page.waitForFunction(
                "window.sketchiExportReady === true || Boolean(window.sketchiExportError)",
              ),
            );

            const harnessError = yield* tryBrowserPromise("evaluate", () =>
              page.evaluate("window.sketchiExportError || null"),
            );
            if (typeof harnessError === "string" && harnessError.length > 0) {
              return yield* Effect.fail(
                BrowserRenderingFailure.make({
                  cause: new Error(harnessError),
                  message: harnessError,
                  operation: "evaluate",
                }),
              );
            }

            const pngBase64 = yield* tryBrowserPromise("evaluate", () =>
              page.evaluate(
                async ({ backgroundColor, excalidraw, padding, scale }) => {
                  const harness = globalThis as unknown as {
                    sketchiExportPng: (
                      scene: unknown,
                      exportOptions: {
                        backgroundColor: string;
                        padding: number;
                        scale: number;
                      },
                    ) => Promise<string>;
                  };

                  return harness.sketchiExportPng(excalidraw, {
                    backgroundColor,
                    padding,
                    scale,
                  });
                },
                {
                  backgroundColor: input.scene.backgroundColor,
                  excalidraw: input.excalidraw,
                  padding: EXPORT_PADDING,
                  scale: EXPORT_SCALE,
                },
              ),
            );

            return yield* Effect.try({
              try: () => base64ToArrayBuffer(pngBase64),
              catch: browserFailure("base64"),
            }).pipe(
              Effect.withSpan("playground.browserRendering.base64"),
              Effect.annotateSpans({ operation: "base64" }),
            );
          }),
      ).pipe(
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
              yield* recordMetric(
                browserRenderingDuration,
                finishedAt - startedAt,
                {
                  operation: "renderPng",
                  outcome: "success",
                  surface: "browser_rendering",
                },
              );
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
              yield* recordMetric(
                browserRenderingDuration,
                finishedAt - startedAt,
                {
                  failureCategory: error._tag,
                  operation: "renderPng",
                  outcome: "failure",
                  surface: "browser_rendering",
                },
              );
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
