import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import {
  CodeModeHttpRequestError,
  handleBuildFlowchartRequest,
  handleBuildMindmapRequest,
  handleBuildSequenceDiagramRequest,
  handleCreateCanvasRequest,
  handlePatchArtifactRequest,
} from "../codemode/api.server";
import { McpTransportError } from "../codemode/mcp.server";
import { handleGenerateDiagramRequest } from "../generation/api.server";
import { PlaygroundCodeModeUsage } from "../codemode/usage-events.server";
import { PlaygroundRequestMetadata } from "./context.server";
import { RequestBodyReadError } from "./request-body.server";
import { makePlaygroundRuntime, runPlaygroundEffect } from "./runtime.server";

function boundary(request: Request) {
  return { env: {}, platform: { waitUntilPromise: () => undefined }, request };
}

describe("HTTP runtime boundaries", () => {
  it.each([
    {
      error: CodeModeHttpRequestError.make({
        cause: "private cause",
        message: "private error",
      }),
      status: 400,
    },
    {
      error: McpTransportError.make({
        cause: "private cause",
        message: "private error",
      }),
      status: 500,
    },
    {
      error: RequestBodyReadError.make({
        cause: "private cause",
        message: "private error",
      }),
      status: 400,
    },
  ])(
    "maps $error._tag and logs bounded request metadata",
    async ({ error, status }) => {
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const runtime = makePlaygroundRuntime();
      try {
        const response = await runtime.run(
          Effect.fail(error),
          boundary(
            new Request("https://studio.test/mcp", {
              headers: { "x-sketchi-trace-id": "safe_trace" },
            }),
          ),
        );
        expect(response.status).toBe(status);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(await response.text()).not.toContain("private");
        await runtime.dispose();
        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "effect.log",
            level: "Error",
            fields: { error_tag: error._tag },
            annotations: expect.objectContaining({
              "request.route": "/mcp",
              "sketchi.trace_id": "safe_trace",
            }),
          }),
        );
      } finally {
        await runtime.dispose();
        log.mockRestore();
      }
    },
  );
  it.each([
    handleBuildFlowchartRequest,
    handleBuildMindmapRequest,
    handleBuildSequenceDiagramRequest,
    handleCreateCanvasRequest,
    handleGenerateDiagramRequest,
    (request: Request) => handlePatchArtifactRequest(request, "id"),
  ])("maps a failed body stream through the real handler", async (handler) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("private body failure"));
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      body: stream,
      duplex: "half",
    };
    const request = new Request("https://studio.test/api/chat", init);
    const response = await runPlaygroundEffect(
      handler(request),
      boundary(request),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "The request body could not be read.",
    });
  });
  it.each(["bad/id", "bad.id", "x".repeat(65), "", "bad id"])(
    "replaces invalid correlation header %s",
    async (value) => {
      const request = new Request("https://studio.test/mcp", {
        headers: {
          "x-sketchi-run-id": value,
          "x-sketchi-attempt-id": value,
          "x-sketchi-trace-id": value,
        },
      });
      const result = await runPlaygroundEffect(
        Effect.gen(function* () {
          const usage = yield* PlaygroundCodeModeUsage;
          const metadata = yield* PlaygroundRequestMetadata;
          return { ...(yield* usage.createContext), traceId: metadata.traceId };
        }),
        boundary(request),
      );
      expect(result.runId).toMatch(/^run_[A-Za-z0-9_-]+$/);
      expect(result.attemptId).toMatch(/^attempt_[A-Za-z0-9_-]+$/);
      expect(result.traceId).toMatch(/^trace_[A-Za-z0-9_-]+$/);
    },
  );
  it("preserves valid IDs through the 64-character boundary", async () => {
    const value = "A_" + "x".repeat(62);
    const request = new Request("https://studio.test/mcp", {
      headers: {
        "x-sketchi-run-id": value,
        "x-sketchi-attempt-id": value,
        "x-sketchi-trace-id": value,
      },
    });
    const result = await runPlaygroundEffect(
      Effect.gen(function* () {
        const usage = yield* PlaygroundCodeModeUsage;
        const metadata = yield* PlaygroundRequestMetadata;
        return { ...(yield* usage.createContext), traceId: metadata.traceId };
      }),
      boundary(request),
    );
    expect(result).toMatchObject({
      runId: value,
      attemptId: value,
      traceId: value,
    });
  });
});
