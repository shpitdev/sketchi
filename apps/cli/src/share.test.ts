import { strict as assert } from "node:assert";

import { afterEach, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import {
  LinkOpener,
  ShareTransport,
  ShareTransportLive,
  makeLinkOpenerLayer,
} from "./share.js";

const originalFetch = globalThis.fetch;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Excalidraw share transport", () => {
  for (const operation of ["upload", "download"] as const) {
    it.effect(`aborts ${operation} fetch on interruption`, () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        let requestSignal: AbortSignal | null | undefined;
        globalThis.fetch = (_input, init) => {
          requestSignal = init?.signal;
          return new Promise<Response>(() => {
            Deferred.doneUnsafe(started, Effect.void);
          });
        };
        const transport = yield* ShareTransport;
        const fiber = yield* (
          operation === "upload"
            ? transport.upload(new Uint8Array())
            : transport.download("fixture_id")
        ).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        assert.equal(requestSignal?.aborted, true);
      }).pipe(Effect.provide(ShareTransportLive)),
    );
  }

  it.effect("cancels a stalled response body on interruption", () =>
    Effect.gen(function* () {
      const reading = yield* Deferred.make<void>();
      let cancelled = false;
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>(
              {
                pull() {
                  Deferred.doneUnsafe(reading, Effect.void);
                },
                cancel() {
                  cancelled = true;
                },
              },
              { highWaterMark: 0 },
            ),
          ),
        );
      const transport = yield* ShareTransport;
      const fiber = yield* transport
        .download("fixture_id")
        .pipe(Effect.forkChild);
      yield* Deferred.await(reading);
      yield* Fiber.interrupt(fiber);
      assert.equal(cancelled, true);
    }).pipe(Effect.provide(ShareTransportLive)),
  );

  it.effect("bounds a stalled download and aborts its fetch", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let requestSignal: AbortSignal | null | undefined;
      globalThis.fetch = (_input, init) => {
        requestSignal = init?.signal;
        return new Promise<Response>(() => {
          Deferred.doneUnsafe(started, Effect.void);
        });
      };
      const transport = yield* ShareTransport;
      const fiber = yield* Effect.flip(transport.download("fixture_id")).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(started);
      yield* TestClock.adjust("15 seconds");
      assert.notEqual(fiber.pollUnsafe(), undefined);
      assert.equal((yield* Fiber.join(fiber)).code, "share_timeout");
      assert.equal(requestSignal?.aborted, true);
    }).pipe(Effect.provide(ShareTransportLive)),
  );
  it.effect("uploads once to the pinned endpoint without redirects", () => {
    let calls = 0;
    globalThis.fetch = (input, init) => {
      calls += 1;
      assert.equal(
        requestUrl(input),
        "https://json.excalidraw.com/api/v2/post/",
      );
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.body instanceof Uint8Array, true);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "fixture_id",
            data: "https://json.excalidraw.com/api/v2/fixture_id",
          }),
          { status: 200 },
        ),
      );
    };
    return Effect.gen(function* () {
      const transport = yield* ShareTransport;
      assert.equal(
        yield* transport.upload(new Uint8Array([1, 2, 3])),
        "fixture_id",
      );
      assert.equal(calls, 1);
    }).pipe(Effect.provide(ShareTransportLive));
  });

  it.effect("constructs the pinned GET URL and maps 404 generically", () => {
    globalThis.fetch = (input, init) => {
      assert.equal(
        requestUrl(input),
        "https://json.excalidraw.com/api/v2/fixture_id",
      );
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      return Promise.resolve(new Response("missing", { status: 404 }));
    };
    return Effect.gen(function* () {
      const transport = yield* ShareTransport;
      const failure = yield* Effect.flip(transport.download("fixture_id"));
      assert.equal(failure.code, "share_link_unavailable");
      assert.equal(failure.message.includes("expired"), false);
    }).pipe(Effect.provide(ShareTransportLive));
  });

  it.effect("rejects oversized upload responses while streaming", () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(64 * 1024));
              controller.enqueue(new Uint8Array([1]));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      );
    return Effect.gen(function* () {
      const transport = yield* ShareTransport;
      const failure = yield* Effect.flip(transport.upload(new Uint8Array()));
      assert.equal(failure.code, "share_transport_failed");
    }).pipe(Effect.provide(ShareTransportLive));
  });

  it.effect("rejects API-shape drift", () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "fixture_id" }), { status: 200 }),
      );
    return Effect.gen(function* () {
      const transport = yield* ShareTransport;
      const failure = yield* Effect.flip(transport.upload(new Uint8Array()));
      assert.equal(failure.code, "share_api_changed");
    }).pipe(Effect.provide(ShareTransportLive));
  });

  it.effect("maps fetch rejection to transport exit-class errors", () => {
    globalThis.fetch = () => Promise.reject(new Error("offline"));
    return Effect.gen(function* () {
      const transport = yield* ShareTransport;
      const failure = yield* Effect.flip(transport.download("fixture_id"));
      assert.equal(failure.code, "share_transport_failed");
    }).pipe(Effect.provide(ShareTransportLive));
  });
});

interface FakeChild {
  onError(listener: () => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): boolean;
}

function fakeChild(
  outcome: "accepted" | "missing" | "nonzero" | "silent",
  killed: { value: boolean },
): FakeChild {
  let errorListener: (() => void) | undefined;
  let exitListener: ((code: number | null) => void) | undefined;
  queueMicrotask(() => {
    if (outcome === "accepted") exitListener?.(0);
    if (outcome === "nonzero") exitListener?.(1);
    if (outcome === "missing") errorListener?.();
  });
  return {
    onError: (listener) => {
      errorListener = listener;
    },
    onExit: (listener) => {
      exitListener = listener;
    },
    kill: () => {
      killed.value = true;
      queueMicrotask(() => exitListener?.(null));
      return true;
    },
  };
}

describe("default browser opener", () => {
  it.effect("escalates a timed-out opener that ignores SIGTERM", () => {
    const signals: NodeJS.Signals[] = [];
    return Effect.gen(function* () {
      const opener = yield* LinkOpener;
      const fiber = yield* opener
        .open("https://excalidraw.com/")
        .pipe(Effect.forkChild);
      yield* TestClock.adjust("4 seconds");
      assert.deepEqual(yield* Fiber.join(fiber), {
        status: "unconfirmed",
        reason: "timeout",
      });
      assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    }).pipe(
      Effect.provide(
        makeLinkOpenerLayer(() => ({
          onError: () => {},
          onExit: () => {},
          kill: (signal) => {
            signals.push(signal);
            return true;
          },
        })),
      ),
    );
  });
  it.effect("kills a pending opener on interruption", () => {
    const killed = { value: false };
    return Effect.gen(function* () {
      const opener = yield* LinkOpener;
      const fiber = yield* opener
        .open("https://excalidraw.com/")
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      assert.equal(killed.value, true);
    }).pipe(
      Effect.provide(makeLinkOpenerLayer(() => fakeChild("silent", killed))),
    );
  });
  it.effect("uses positional arguments with ignored stdio and no shell", () => {
    const captured: Array<unknown> = [];
    const killed = { value: false };
    const layer = makeLinkOpenerLayer((command, args, options) => {
      captured.push(command, args, options);
      return fakeChild("accepted", killed);
    }, "linux");
    return Effect.gen(function* () {
      const opener = yield* LinkOpener;
      assert.deepEqual(
        yield* opener.open("https://excalidraw.com/#json=id,key"),
        { status: "accepted" },
      );
      assert.deepEqual(captured, [
        "xdg-open",
        ["https://excalidraw.com/#json=id,key"],
        { shell: false, stdio: "ignore" },
      ]);
      assert.equal(killed.value, false);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "returns unconfirmed for missing, nonzero, and timed-out openers",
    () =>
      Effect.gen(function* () {
        for (const [outcome, reason] of [
          ["missing", "missing_executable"],
          ["nonzero", "nonzero_exit"],
        ] as const) {
          const killed = { value: false };
          const result = yield* Effect.gen(function* () {
            const opener = yield* LinkOpener;
            return yield* opener.open("https://excalidraw.com/");
          }).pipe(
            Effect.provide(
              makeLinkOpenerLayer(() => fakeChild(outcome, killed), "linux", 5),
            ),
          );
          assert.deepEqual(result, { status: "unconfirmed", reason });
        }
        const killed = { value: false };
        const timeoutFiber = yield* Effect.gen(function* () {
          const opener = yield* LinkOpener;
          return yield* opener.open("https://excalidraw.com/");
        }).pipe(
          Effect.provide(
            makeLinkOpenerLayer(() => fakeChild("silent", killed), "linux", 1),
          ),
          Effect.forkChild,
        );
        yield* TestClock.adjust("1 millis");
        const timedOut = yield* Fiber.join(timeoutFiber);
        assert.deepEqual(timedOut, {
          status: "unconfirmed",
          reason: "timeout",
        });
        assert.equal(killed.value, true);
      }),
  );
});
