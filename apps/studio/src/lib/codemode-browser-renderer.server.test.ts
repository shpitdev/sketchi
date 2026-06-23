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

function renderInput() {
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
  };
}

describe("Cloudflare Browser Run Code Mode renderer", () => {
  const launchMock = vi.mocked(launch);

  beforeEach(() => {
    launchMock.mockReset();
  });

  it("renders through the bundled export harness and closes the session", async () => {
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

    const png = await renderer.renderPng(renderInput());

    expect(launchMock).toHaveBeenCalledWith(browserBinding, {
      keep_alive: 10_000,
    });
    expect(visitedUrl).toBe("https://studio.test/codemode-export-harness");
    expect(page.waitForFunction).toHaveBeenCalledWith(
      "window.sketchiExportReady === true || Boolean(window.sketchiExportError)",
      undefined,
      { timeout: 60_000 },
    );
    expect(new Uint8Array(png)).toEqual(new Uint8Array([80, 78, 71]));
    expect(close).toHaveBeenCalledTimes(1);
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
