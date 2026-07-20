import { launch } from "@cloudflare/playwright";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCloudflareBrowserRunArtifactRenderer,
  type CloudflareBrowserRunBinding,
} from "./codemode-browser-renderer.server";

vi.mock("@cloudflare/playwright", () => ({
  launch: vi.fn(),
}));

const browserBinding: CloudflareBrowserRunBinding = { fetch };

function renderInput(signal = new AbortController().signal) {
  return {
    scene: {
      accentColor: "#000000",
      backgroundColor: "#ffffff",
      diagramId: "test-diagram",
      elements: [],
      height: 120,
      title: "Test diagram",
      width: 180,
    },
    excalidraw: {
      appState: {},
      elements: [],
    },
    signal,
  };
}

describe("Cloudflare Browser Run Code Mode renderer", () => {
  const launchMock = vi.mocked(launch);

  beforeEach(() => {
    launchMock.mockReset();
  });

  it("renders through the bundled export harness and closes the session", async () => {
    const controller = new AbortController();
    let visitedUrl = "";
    const close = vi.fn(async () => {});
    const page = {
      goto: vi.fn(async (value: string) => {
        visitedUrl = value;
      }),
      waitForFunction: vi.fn(async () => {}),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(btoa("PNG")),
    };
    const browser = {
      close,
      newPage: vi.fn(async () => page),
    };
    launchMock.mockResolvedValue(
      browser as unknown as Awaited<ReturnType<typeof launch>>,
    );

    const renderer = createCloudflareBrowserRunArtifactRenderer(
      browserBinding,
      {
        assetOrigin: "https://studio.test",
      },
    );

    const png = await renderer.renderPng(renderInput(controller.signal));

    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({ fetch: expect.any(Function) }),
      { keep_alive: 10_000 },
    );
    expect(visitedUrl).toBe("https://studio.test/codemode-export-harness");
    expect(page.waitForFunction).toHaveBeenCalledWith(
      "window.sketchiExportReady === true || Boolean(window.sketchiExportError)",
      undefined,
      { timeout: 60_000 },
    );
    expect(new Uint8Array(png)).toEqual(new Uint8Array([80, 78, 71]));
    expect(close).toHaveBeenCalledTimes(1);
    controller.abort(new DOMException("late cancellation", "AbortError"));
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("promptly closes the Browser Run session and cancels in-flight harness work on abort", async () => {
    const controller = new AbortController();
    let rejectWait: (reason: Error) => void = () => {};
    let markWaitStarted: () => void = () => {};
    const waitStarted = new Promise<void>((resolve) => {
      markWaitStarted = resolve;
    });
    const waitForFunction = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectWait = reject;
          markWaitStarted();
        }),
    );
    const close = vi.fn(async () => {
      rejectWait(new Error("Browser session closed after interruption"));
    });
    const page = {
      goto: vi.fn(async () => {}),
      waitForFunction,
      evaluate: vi.fn(),
    };
    const browser = {
      close,
      newPage: vi.fn(async () => page),
    };
    launchMock.mockResolvedValue(
      browser as unknown as Awaited<ReturnType<typeof launch>>,
    );

    const renderer = createCloudflareBrowserRunArtifactRenderer(browserBinding);
    const render = renderer.renderPng(renderInput(controller.signal));
    await waitStarted;
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(render).rejects.toThrow(
      "Browser session closed after interruption",
    );
    expect(waitForFunction).toHaveBeenCalledTimes(1);
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith({
      reason: "Code Mode PNG render interrupted",
    });
  });

  it("closes the Browser Run session when page creation fails", async () => {
    const close = vi.fn(async () => {});
    const browser = {
      close,
      newPage: vi.fn(async () => {
        throw new Error("new page failed");
      }),
    };
    launchMock.mockResolvedValue(
      browser as unknown as Awaited<ReturnType<typeof launch>>,
    );

    const renderer = createCloudflareBrowserRunArtifactRenderer(browserBinding);

    await expect(renderer.renderPng(renderInput())).rejects.toThrow(
      "new page failed",
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});
