import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Schema } from "effect";

import {
  makeStudioJsonPersistence,
  makeStudioObjectStoreLayer,
  MemoryStudioObjectBucket,
  StudioObjectStore,
  type StudioObjectBucket,
  type StudioObjectBucketBody,
  type StudioObjectBucketListOptions,
} from "./bucket.js";
import {
  makeStudioSourceArtifactStoreLayer,
  StudioSourceArtifactStore,
  type StudioSourceArtifactLoadResult,
} from "./source-artifacts.js";

class FailingBucket implements StudioObjectBucket {
  constructor(private readonly operation: "delete" | "get" | "list" | "put") {}

  async delete(): Promise<unknown> {
    if (this.operation === "delete") {
      throw new Error("R2 delete failed");
    }
    return null;
  }

  async get() {
    if (this.operation === "get") {
      throw new Error("R2 get failed");
    }
    return null;
  }

  async list(options: StudioObjectBucketListOptions) {
    if (this.operation === "list") {
      throw new Error("R2 list failed");
    }
    return { objects: [], prefix: options.prefix, truncated: false };
  }

  async put(_key: string, _value: StudioObjectBucketBody) {
    if (this.operation === "put") {
      throw new Error("R2 put failed");
    }
    return null;
  }
}

describe("StudioObjectStore R2 boundary", () => {
  const operations: ReadonlyArray<"delete" | "get" | "list" | "put"> = [
    "get",
    "put",
    "list",
    "delete",
  ];

  for (const operation of operations) {
    it.layer(makeStudioObjectStoreLayer(new FailingBucket(operation)))(
      `${operation} failure`,
      (it) => {
        it.effect(`wraps R2 ${operation} failures once with their cause`, () =>
          Effect.gen(function* () {
            const objectStore = yield* StudioObjectStore;
            const effect =
              operation === "get"
                ? objectStore.getText("studio/test.json")
                : operation === "put"
                  ? objectStore.put("studio/test.json", "{}")
                  : operation === "list"
                    ? objectStore.list({ prefix: "studio/" })
                    : objectStore.delete("studio/test.json");
            const error = yield* Effect.flip(effect);

            assert.strictEqual(error._tag, "StudioStorageError");
            assert.strictEqual(error.operation, operation);
            assert.instanceOf(error.cause, Error);
            assert.strictEqual(error.message, `R2 ${operation} failed`);
          }),
        );
      },
    );
  }

  const memoryBucket = new MemoryStudioObjectBucket();

  it.layer(makeStudioObjectStoreLayer(memoryBucket))(
    "in-memory success",
    (it) => {
      it.effect("supports put, get, list, and delete through one service", () =>
        Effect.gen(function* () {
          const objectStore = yield* StudioObjectStore;
          yield* objectStore.put("studio/test.json", '{"ok":true}');
          assert.strictEqual(
            yield* objectStore.getText("studio/test.json"),
            '{"ok":true}',
          );
          assert.deepStrictEqual(
            (yield* objectStore.list({ prefix: "studio/" })).objects,
            [{ key: "studio/test.json" }],
          );
          yield* objectStore.delete("studio/test.json");
          assert.strictEqual(
            yield* objectStore.getText("studio/test.json"),
            null,
          );
        }),
      );

      it.effect(
        "round-trips transformed codecs through their persisted bytes",
        () =>
          Effect.gen(function* () {
            const objectStore = yield* StudioObjectStore;
            const persistence = makeStudioJsonPersistence(objectStore);
            const key = "studio/transformed-number.json";

            yield* persistence.put(key, Schema.NumberFromString, 42);
            assert.strictEqual(memoryBucket.objects.get(key), '"42"');
            assert.strictEqual(
              yield* persistence.read(
                key,
                Schema.NumberFromString,
                "project",
                "transformed-number",
              ),
              42,
            );

            memoryBucket.objects.set(key, '"43"');
            assert.strictEqual(
              yield* persistence.read(
                key,
                Schema.NumberFromString,
                "project",
                "transformed-number",
              ),
              43,
            );
          }),
      );
    },
  );
});

describe("StudioSourceArtifactStore boundary", () => {
  it.layer(
    makeStudioSourceArtifactStoreLayer({
      async load() {
        throw new Error("source R2 failed");
      },
    }),
  )("foreign failure", (it) => {
    it.effect("wraps rejected loaders with the retained cause", () =>
      Effect.gen(function* () {
        const sourceArtifacts = yield* StudioSourceArtifactStore;
        const error = yield* Effect.flip(
          sourceArtifacts.load("artifact-failed"),
        );

        assert.strictEqual(error._tag, "StudioSourceArtifactError");
        assert.strictEqual(error.code, "storage_failed");
        assert.instanceOf(error.cause, Error);
      }),
    );
  });

  const observedSignal: { value: AbortSignal | undefined } = {
    value: undefined,
  };
  const readObservedSignal = () => observedSignal.value;
  const cancellationLayer = makeStudioSourceArtifactStoreLayer({
    load(_artifactId, signal) {
      observedSignal.value = signal;
      return new Promise<StudioSourceArtifactLoadResult>(() => undefined);
    },
  });

  it.layer(cancellationLayer)("cancellation", (it) => {
    it.effect("forwards interruption without translating it to an error", () =>
      Effect.gen(function* () {
        observedSignal.value = undefined;
        const sourceArtifacts = yield* StudioSourceArtifactStore;
        const fiber = yield* Effect.forkChild(
          sourceArtifacts.load("artifact-interrupted"),
        );

        while (!readObservedSignal()) {
          yield* Effect.yieldNow;
        }

        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        const signal = readObservedSignal();
        if (!signal) {
          return assert.fail("Source loader did not receive an AbortSignal.");
        }
        assert.isTrue(signal.aborted);
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          assert.isTrue(Cause.hasInterrupts(exit.cause));
        }
      }),
    );
  });
});
