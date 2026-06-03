import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import { exportDiagramToPng } from "./export-png.js";

const BASE_DIR = resolve(process.cwd(), "tmp-exporter");

describe("exportDiagramToPng", () => {
  test("resolves a share URL, renders PNG bytes, and writes inside the session root", async () => {
    const calls: string[] = [];
    const result = await exportDiagramToPng(
      {
        apiBase: "https://www.sketchi.app",
        baseDir: BASE_DIR,
        sessionId: "session-1",
        shareUrl: "https://excalidraw.com/#json=share,key",
        traceId: "trace-export",
      },
      {
        closeBrowser: () => {
          calls.push("close");
          return Promise.resolve();
        },
        resolveExcalidrawFromShareUrl: (input) => {
          expect(input.traceId).toBe("trace-export");
          calls.push("resolve");
          return Promise.resolve({
            elements: [
              {
                id: "box",
                type: "rectangle",
                x: 0,
                y: 0,
                width: 100,
                height: 50,
              },
              {
                id: "label",
                type: "text",
                x: 10,
                y: 10,
                width: 50,
                height: 20,
              },
            ],
            appState: {},
          });
        },
        renderElementsToPng: (elements) => {
          calls.push(`render:${elements.length}`);
          return Promise.resolve({
            png: Buffer.from("png-bytes"),
            durationMs: 12,
          });
        },
        writePng: (path, png) => {
          calls.push(`write:${png.length}`);
          expect(path).toContain(".sketchi/sessions/session-1/png");
          return Promise.resolve(path);
        },
      }
    );

    expect(calls).toEqual(["resolve", "render:2", "write:9", "close"]);
    expect(result.pngBytes).toBe(9);
    expect(result.pngDurationMs).toBe(12);
    expect(result.shareLink).toMatchObject({ shareId: "share" });
    expect(result.summary).toMatchObject({
      elementCount: 2,
      shapeCount: 1,
      textCount: 1,
    });
  });

  test("shares inline Excalidraw scenes before rendering", async () => {
    const result = await exportDiagramToPng(
      {
        apiBase: "https://www.sketchi.app",
        baseDir: BASE_DIR,
        excalidraw: {
          elements: [{ id: "box", type: "rectangle" }],
          appState: { theme: "light" },
        },
        outputPath: "inline.png",
        sessionId: "session-2",
      },
      {
        closeBrowser: () => Promise.resolve(),
        renderElementsToPng: () =>
          Promise.resolve({
            png: Buffer.from("png"),
            durationMs: 3,
          }),
        shareElements: (_apiBase, scene) => {
          expect(scene.appState).toEqual({ theme: "light" });
          return Promise.resolve({
            url: "https://excalidraw.com/#json=inline,key",
            shareId: "inline",
            encryptionKey: "key",
          });
        },
        writePng: (path) => Promise.resolve(path),
      }
    );

    expect(result.pngPath).toContain(
      ".sketchi/sessions/session-2/png/inline.png"
    );
    expect(result.shareLink).toMatchObject({ shareId: "inline" });
  });

  test("supports metadata-only output when rendering is explicitly skipped", async () => {
    const result = await exportDiagramToPng(
      {
        apiBase: "https://www.sketchi.app",
        baseDir: BASE_DIR,
        excalidraw: {
          elements: [{ id: "box", type: "rectangle" }],
          appState: {},
        },
        sessionId: "session-3",
        skipRender: true,
      },
      {
        shareElements: () =>
          Promise.resolve({
            url: "https://excalidraw.com/#json=skip,key",
            shareId: "skip",
            encryptionKey: "key",
          }),
      }
    );

    expect(result).toMatchObject({
      pngPath: null,
      pngSkipped: true,
      shareLink: { shareId: "skip" },
      summary: { elementCount: 1 },
    });
  });
});
