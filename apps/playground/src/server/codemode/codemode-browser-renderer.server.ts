import "@tanstack/react-start/server-only";

import type { BrowserWorker } from "@cloudflare/playwright";
import type { CodeModeArtifactRenderer } from "@sketchi/diagram-agent";

export type CloudflareBrowserRunBinding = BrowserWorker;

const RENDER_TIMEOUT_MS = 60_000;
const EXPORT_SCALE = 2;
const EXPORT_PADDING = 20;
const DEFAULT_ASSET_ORIGIN = "https://sketchi-studio.dimethyl.workers.dev";
const HARNESS_PATH = "/codemode-export-harness";

export interface CloudflareBrowserRunRendererOptions {
  assetOrigin?: string;
}

export function createCloudflareBrowserRunArtifactRenderer(
  browserBinding: CloudflareBrowserRunBinding,
  options: CloudflareBrowserRunRendererOptions = {},
): CodeModeArtifactRenderer {
  const harnessUrl = new URL(
    HARNESS_PATH,
    options.assetOrigin ?? DEFAULT_ASSET_ORIGIN,
  ).toString();

  return {
    async renderPng(input) {
      input.signal.throwIfAborted();
      const { launch } = await import("@cloudflare/playwright");
      const browser = await launch(
        browserBindingWithSignal(browserBinding, input.signal),
        { keep_alive: 10_000 },
      );
      let closePromise: Promise<void> | undefined;
      const closeBrowser = (reason?: string): Promise<void> => {
        closePromise ??= browser.close(reason ? { reason } : undefined);
        return closePromise;
      };
      const abortReason = "Code Mode PNG render interrupted";
      const onAbort = () => {
        void closeBrowser(abortReason).catch(() => {});
      };
      input.signal.addEventListener("abort", onAbort, { once: true });

      try {
        if (input.signal.aborted) {
          onAbort();
          input.signal.throwIfAborted();
        }
        const page = await browser.newPage();
        await page.goto(harnessUrl, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForFunction(
          "window.sketchiExportReady === true || Boolean(window.sketchiExportError)",
          undefined,
          {
            timeout: RENDER_TIMEOUT_MS,
          },
        );

        const harnessError = await page.evaluate(
          "window.sketchiExportError || null",
        );
        if (typeof harnessError === "string" && harnessError.length > 0) {
          throw new Error(harnessError);
        }

        const pngBase64 = await page.evaluate(
          async ({ backgroundColor, excalidraw, padding, scale }) => {
            const harness = globalThis as unknown as {
              sketchiExportPng: (
                scene: unknown,
                options: {
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
        );

        return base64ToArrayBuffer(pngBase64);
      } finally {
        input.signal.removeEventListener("abort", onAbort);
        await closeBrowser();
      }
    },
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
