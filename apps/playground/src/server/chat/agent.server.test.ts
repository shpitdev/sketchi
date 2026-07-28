import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import type { BuildFlowchartResult } from "@sketchi/diagram-agent";

import { PlaygroundRequestMetadata } from "../runtime/context.server";
import {
  PlaygroundRequestCallbacks,
  runPlaygroundEffect,
} from "../runtime/runtime.server";
import { makeStudioFlowchartToolCallback } from "./agent.server";

const repairResult: BuildFlowchartResult = {
  ok: false,
  status: "invalid_input",
  issues: [],
};

describe("Studio agent request callbacks", () => {
  it("preserves the chat request trace in the build_flowchart callback", async () => {
    let callbackContext:
      | {
          parentSpanId: string | undefined;
          spanId: string;
          spanName: string;
          spanTraceId: string;
          traceId: string;
        }
      | undefined;
    const observeContext = Effect.gen(function* () {
      const metadata = yield* PlaygroundRequestMetadata;
      const span = yield* Effect.currentSpan;
      const parent = Option.getOrUndefined(span.parent);
      return {
        parentSpanId: parent?.spanId,
        spanName: span.name,
        spanId: span.spanId,
        spanTraceId: span.traceId,
        traceId: metadata.traceId,
      };
    });
    const request = new Request("https://studio.test/api/chat", {
      headers: { "x-sketchi-trace-id": "trace-chat-tool" },
      method: "POST",
    });

    const root = await runPlaygroundEffect(
      Effect.gen(function* () {
        const callbacks = yield* PlaygroundRequestCallbacks;
        const requestContext = yield* observeContext;
        const execute = makeStudioFlowchartToolCallback(
          {
            execute: () =>
              observeContext.pipe(
                Effect.tap((context) =>
                  Effect.sync(() => {
                    callbackContext = context;
                  }),
                ),
                Effect.as(repairResult),
              ),
          },
          callbacks.runPromise,
        );
        return {
          callback: execute({
            spec: {
              title: "Trace context",
              nodes: [
                { id: "start", kind: "start", label: "Start" },
                { id: "done", kind: "end", label: "Done" },
              ],
              edges: [{ source: "start", target: "done" }],
              layout: { direction: "TB" },
              style: {
                accentColor: "#2563eb",
                backgroundColor: "#ffffff",
              },
            },
          }),
          requestContext,
        };
      }),
      {
        env: {},
        platform: { waitUntilPromise: () => undefined },
        request,
      },
    );

    await root.callback;
    expect(callbackContext?.spanTraceId).toBe(root.requestContext.spanTraceId);
    expect(callbackContext?.parentSpanId).toBe(root.requestContext.spanId);
    expect(callbackContext?.spanName).toBe("playground.request.callback");
    expect(callbackContext?.traceId).toBe("trace-chat-tool");
  });
});
