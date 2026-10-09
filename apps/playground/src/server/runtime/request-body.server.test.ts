import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Fiber } from "effect";

import { readBoundedJson } from "./request-body.server";

function streamRequest(
  stream: ReadableStream<Uint8Array>,
  headers: HeadersInit = {},
) {
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    body: stream,
    duplex: "half",
    headers,
  };
  return new Request("https://studio.test/api/chat", init);
}

describe("bounded JSON reader", () => {
  it("counts UTF-8 bytes and accepts the exact boundary", async () => {
    const body = JSON.stringify({ text: "é" });
    const size = new TextEncoder().encode(body).byteLength;
    const request = () =>
      new Request("https://studio.test/api/chat", { method: "POST", body });
    expect(await Effect.runPromise(readBoundedJson(request(), size))).toEqual({
      _tag: "Body",
      body: { text: "é" },
    });
    expect(
      await Effect.runPromise(readBoundedJson(request(), size - 1)),
    ).toEqual({ _tag: "TooLarge" });
  });
  it("uses stream bytes even when Content-Length understates them", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(9));
      },
      cancel() {
        cancelled = true;
      },
    });
    const result = await Effect.runPromise(
      readBoundedJson(streamRequest(stream, { "Content-Length": "1" }), 8),
    );
    expect(result._tag).toBe("TooLarge");
    expect(cancelled).toBe(true);
  });
  it("cancels an advertised oversized body without pulling it", async () => {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulls += 1;
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    expect(
      await Effect.runPromise(
        readBoundedJson(streamRequest(stream, { "Content-Length": "9" }), 8),
      ),
    ).toEqual({ _tag: "TooLarge" });
    expect(pulls).toBe(0);
    expect(cancelled).toBe(true);
  });
  it("keeps invalid JSON separate from transport failures", async () => {
    const malformed = new Request("https://studio.test/api/chat", {
      method: "POST",
      body: "{",
    });
    expect(await Effect.runPromise(readBoundedJson(malformed, 8))).toEqual({
      _tag: "InvalidJson",
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("read failed"));
      },
    });
    const error = await Effect.runPromise(
      readBoundedJson(streamRequest(stream), 8).pipe(Effect.flip),
    );
    expect(error._tag).toBe("RequestBodyReadError");
  });
  it("cancels a blocked read on interruption without producing a domain failure", async () => {
    const started = Promise.withResolvers<void>();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          started.resolve();
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const request = streamRequest(stream);
    const fiber = Effect.runFork(readBoundedJson(request, 8));
    await started.promise;
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
    expect(cancelled).toBe(true);
    expect(request.body?.locked).toBe(false);
  });
});
