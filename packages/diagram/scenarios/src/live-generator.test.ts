import { assert, describe, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Fiber } from "effect";
import { afterEach, vi } from "vitest";

import { runLiveGenerator } from "./live-generator.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("live generator offline lifecycle", () => {
  it.live(
    "preserves the generated response envelope for CLI requirement enforcement",
    () =>
      Effect.gen(function* () {
        vi.spyOn(process.stdin, "resume").mockReturnValue(process.stdin);
        vi.stubEnv("SKETCHI_SCENARIO_ID", "offline");
        vi.stubEnv("SKETCHI_PLAYGROUND_URL", "https://offline.invalid");
        vi.stubEnv("SKETCHI_LIVE_RESULT_DIR", "");
        const envelope =
          '{"title":"Offline","intent":{"requestedKind":"flowchart","nativeKind":"flowchart","requirements":[]},"diagram":{"type":"flowchart"}}';
        vi.stubGlobal("fetch", () =>
          Promise.resolve(
            Response.json({
              model: "fixture",
              scenarioId: "offline",
              candidates: [
                {
                  model: "fixture",
                  provider: "fixture",
                  diagnostics: [],
                  diagramValid: true,
                  diagramText: '{"type":"flowchart"}',
                  text: envelope,
                },
              ],
            }),
          ),
        );
        const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
        const fiber = yield* runLiveGenerator().pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        process.stdin.emit("end");
        yield* Fiber.join(fiber);
        assert.isTrue(
          stdout.mock.calls.some(([value]) => value === `${envelope}\n`),
        );
      }),
  );
  it.live(
    "releases stdin listeners when interrupted before input completes",
    () =>
      Effect.gen(function* () {
        vi.spyOn(process.stdin, "resume").mockReturnValue(process.stdin);
        const dataListeners = process.stdin.listenerCount("data");
        const endListeners = process.stdin.listenerCount("end");
        const fiber = yield* runLiveGenerator().pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        assert.strictEqual(
          process.stdin.listenerCount("data"),
          dataListeners + 1,
        );
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure")
          assert.isTrue(Cause.hasInterrupts(exit.cause));
        assert.strictEqual(process.stdin.listenerCount("data"), dataListeners);
        assert.strictEqual(process.stdin.listenerCount("end"), endListeners);
      }),
  );

  it.live(
    "aborts a pending foreign request without converting interruption to failure",
    () =>
      Effect.gen(function* () {
        vi.spyOn(process.stdin, "resume").mockReturnValue(process.stdin);
        vi.stubEnv("SKETCHI_SCENARIO_ID", "offline");
        vi.stubEnv("SKETCHI_PLAYGROUND_URL", "https://offline.invalid");
        const started = yield* Deferred.make<void>();
        let aborted = false;
        vi.stubGlobal(
          "fetch",
          (_url: unknown, options: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              Effect.runSync(Deferred.succeed(started, undefined));
              options.signal?.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  reject(new Error("aborted"));
                },
                { once: true },
              );
            }),
        );
        const fiber = yield* runLiveGenerator().pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        process.stdin.emit("end");
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        assert.isTrue(aborted);
        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          assert.isTrue(Cause.hasInterrupts(exit.cause));
          assert.strictEqual(Cause.findError(exit.cause)._tag, "Failure");
        }
      }),
  );
});
