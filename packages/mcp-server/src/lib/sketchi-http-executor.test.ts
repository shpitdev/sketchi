import { describe, expect, test } from "vitest";

import { createSketchiHttpToolExecutor } from "./sketchi-http-executor.js";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("Sketchi HTTP MCP executor", () => {
  test("posts diagram_from_prompt calls to the thread-run API", async () => {
    const requests: Array<{ body: unknown; headers: Headers; url: string }> =
      [];
    const executor = createSketchiHttpToolExecutor({
      apiBase: "https://sketchi.app/",
      authorizationToken: "test-token",
      traceIdFactory: () => "trace-test",
      fetch: (url, init) => {
        requests.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return Promise.resolve(
          createJsonResponse({
            status: "persisted",
            runStatus: "persisted",
            runError: null,
            sessionId: "session-1",
            shareLink: { url: "https://excalidraw.com/#json=a,b" },
          })
        );
      },
    });

    const result = await executor({
      name: "diagram_from_prompt",
      arguments: { prompt: "Map the auth flow", sessionId: "session-1" },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://www.sketchi.app/api/diagrams/thread-run"
    );
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(requests[0]?.headers.get("x-trace-id")).toBe("trace-test");
    expect(requests[0]?.body).toMatchObject({
      prompt: "Map the auth flow",
      sessionId: "session-1",
      traceId: "trace-test",
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ sessionId: "session-1" });
  });

  test("seeds inline Excalidraw scenes before tweak calls", async () => {
    const urls: string[] = [];
    const executor = createSketchiHttpToolExecutor({
      apiBase: "https://www.sketchi.app",
      traceIdFactory: () => "trace-seed",
      fetch: (url) => {
        urls.push(String(url));
        if (String(url).endsWith("/api/diagrams/session-seed")) {
          return Promise.resolve(
            createJsonResponse({
              status: "success",
              sessionId: "seeded-session",
            })
          );
        }
        return Promise.resolve(
          createJsonResponse({
            status: "persisted",
            runStatus: "persisted",
            runError: null,
            sessionId: "seeded-session",
            shareLink: { url: "https://excalidraw.com/#json=c,d" },
          })
        );
      },
    });

    const result = await executor({
      name: "diagram_tweak",
      arguments: {
        request: "Make the success path green",
        excalidraw: { elements: [{ id: "box-1", type: "rectangle" }] },
      },
    });

    expect(urls).toEqual([
      "https://www.sketchi.app/api/diagrams/session-seed",
      "https://www.sketchi.app/api/diagrams/thread-run",
    ]);
    expect(result.structuredContent).toMatchObject({
      sessionId: "seeded-session",
    });
  });

  test("exports diagram_to_png calls through the shared PNG exporter", async () => {
    const executor = createSketchiHttpToolExecutor({
      allowUnsafeOutputPath: true,
      apiBase: "https://sketchi.app/",
      authorizationToken: "test-token",
      baseDir: "/workspace/sketchi",
      skipPngRender: true,
      traceIdFactory: () => "trace-png",
      exportDiagramToPng: (input) => {
        expect(input).toMatchObject({
          allowUnsafeOutputPath: true,
          apiBase: "https://www.sketchi.app",
          authorizationHeader: "Bearer test-token",
          baseDir: "/workspace/sketchi",
          outputPath: "diagram.png",
          sessionId: "session-png",
          shareUrl: "https://excalidraw.com/#json=share,key",
          skipRender: true,
          traceId: "trace-png",
        });
        expect(input.renderOptions).toEqual({
          background: false,
          padding: 24,
          scale: 3,
        });

        return Promise.resolve({
          pngPath: null,
          pngSkipped: true,
          shareLink: {
            url: "https://excalidraw.com/#json=share,key",
            shareId: "share",
            encryptionKey: "key",
          },
          summary: {
            arrowCount: 0,
            bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
            deletedCount: 0,
            elementCount: 1,
            overlapPairs: 0,
            shapeCount: 1,
            textCount: 0,
            unboundArrowCount: 0,
          },
        });
      },
    });

    const result = await executor({
      name: "diagram_to_png",
      arguments: {
        background: false,
        outputPath: "diagram.png",
        padding: 24,
        scale: 3,
        sessionId: "session-png",
        shareUrl: "https://excalidraw.com/#json=share,key",
      },
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      pngSkipped: true,
      shareLink: { shareId: "share" },
      summary: { elementCount: 1 },
    });
  });

  test("returns an MCP error for missing PNG sources and host-owned grading", async () => {
    const executor = createSketchiHttpToolExecutor();

    await expect(
      executor({ name: "diagram_to_png", arguments: {} })
    ).resolves.toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "Provide shareUrl, excalidrawPath, or excalidraw input.",
        },
      ],
    });
    await expect(
      executor({ name: "diagram_grade", arguments: { prompt: "grade it" } })
    ).resolves.toMatchObject({ isError: true });
  });
});
