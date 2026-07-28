import { assert, expect, it, layer } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Fiber, Layer } from "effect";

import {
  ARTIFACT_MIME_TYPES,
  CodeModeArtifactStorage,
  CodeModeArtifactStorageMemory,
  jsonSizeBytes,
  makeCodeModeArtifactStorageR2Layer,
  type ArtifactWriteInput,
  type CodeModeArtifactStorageShape,
  type CodeModeObjectBucket,
  type CodeModeObjectBucketBody,
  type CodeModeObjectBucketObject,
  type StoredArtifactFormat,
} from "./artifacts";

class MemoryBucket implements CodeModeObjectBucket {
  readonly objects = new Map<string, CodeModeObjectBucketBody>();

  async get(key: string): Promise<CodeModeObjectBucketObject | null> {
    const value = this.objects.get(key);
    if (value === undefined) {
      return null;
    }

    const bytes =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : new Uint8Array(value);

    return {
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
    };
  }

  async put(key: string, value: CodeModeObjectBucketBody): Promise<unknown> {
    this.objects.set(key, value);
    return null;
  }
}

class FailingBucket extends MemoryBucket {
  override async put(): Promise<unknown> {
    throw new Error("R2 write denied");
  }
}

class HangingBucket extends MemoryBucket {
  readonly writeStarted = Promise.withResolvers<void>();

  override async put(): Promise<never> {
    this.writeStarted.resolve();
    return new Promise<never>(() => undefined);
  }
}

function storedFormats(): StoredArtifactFormat[] {
  const scene = { diagramId: "diagram-child", elements: [] };
  const excalidraw = { type: "excalidraw", version: 2, elements: [] };
  const png = new Uint8Array([137, 80, 78, 71]);

  return [
    {
      data: scene,
      format: "scene",
      mimeType: ARTIFACT_MIME_TYPES.scene,
      sizeBytes: jsonSizeBytes(scene),
    },
    {
      data: excalidraw,
      format: "excalidraw",
      mimeType: ARTIFACT_MIME_TYPES.excalidraw,
      sizeBytes: jsonSizeBytes(excalidraw),
    },
    {
      data: png,
      format: "png",
      mimeType: ARTIFACT_MIME_TYPES.png,
      sizeBytes: png.byteLength,
    },
  ];
}

function writeInput(): ArtifactWriteInput {
  return {
    artifactId: "artifact-child",
    diagramId: "diagram-child",
    formats: storedFormats(),
    inlineFormats: ["scene"],
    provenance: { sourceArtifactId: "artifact-parent" },
  };
}

const storageRoundTrip = Effect.fn("codeMode.artifacts.test.roundTrip")(
  function* () {
    const storage = yield* CodeModeArtifactStorage;
    const bundle = yield* storage.write(writeInput());
    const manifest = yield* storage.readManifest("artifact-child");
    const scene = yield* storage.read("artifact-child", "scene");
    const excalidraw = yield* storage.read("artifact-child", "excalidraw");
    const png = yield* storage.read("artifact-child", "png");
    return { bundle, excalidraw, manifest, png, scene };
  },
);

layer(CodeModeArtifactStorageMemory)("memory artifact storage layer", (it) => {
  it.effect(
    "substitutes into the storage workflow and isolates provenance",
    () =>
      Effect.gen(function* () {
        const result = yield* storageRoundTrip();

        assert.deepStrictEqual(result.bundle.provenance, {
          sourceArtifactId: "artifact-parent",
        });
        if (!result.bundle.provenance) {
          return assert.fail(
            "Expected the returned bundle to include provenance.",
          );
        }
        result.bundle.provenance.sourceArtifactId = "artifact-mutated";

        const storage = yield* CodeModeArtifactStorage;
        const manifest = yield* storage.readManifest("artifact-child");
        assert.deepStrictEqual(manifest?.provenance, {
          sourceArtifactId: "artifact-parent",
        });
        assert.strictEqual(result.png?.sizeBytes, 4);
      }),
  );
});

const r2Bucket = new MemoryBucket();
layer(makeCodeModeArtifactStorageR2Layer(r2Bucket, { prefix: "codemode" }))(
  "R2 artifact storage layer",
  (it) => {
    it.effect("substitutes without changing the storage workflow", () =>
      Effect.gen(function* () {
        const result = yield* storageRoundTrip();

        expect(result.manifest).toMatchObject({
          artifactId: "artifact-child",
          provenance: { sourceArtifactId: "artifact-parent" },
          formats: [
            { format: "scene" },
            { format: "excalidraw" },
            { format: "png" },
          ],
        });
        expect(result.scene).toMatchObject({ format: "scene" });
        expect(result.excalidraw).toMatchObject({ format: "excalidraw" });
        expect(result.png).toMatchObject({ format: "png", sizeBytes: 4 });
        assert.deepStrictEqual([...r2Bucket.objects.keys()].sort(), [
          "codemode/artifact-child/excalidraw.json",
          "codemode/artifact-child/manifest.json",
          "codemode/artifact-child/png.png",
          "codemode/artifact-child/scene.json",
        ]);
      }),
    );
  },
);

layer(makeCodeModeArtifactStorageR2Layer(new FailingBucket()))(
  "typed R2 storage failure",
  (it) => {
    it.effect("keeps the binding failure in the typed error channel", () =>
      Effect.gen(function* () {
        const storage = yield* CodeModeArtifactStorage;
        const error = yield* storage.write(writeInput()).pipe(Effect.flip);

        assert.strictEqual(error._tag, "CodeModeArtifactStorageError");
        assert.strictEqual(error.operation, "write");
        assert.strictEqual(error.message, "R2 write denied");
      }),
    );
  },
);

const hangingBucket = new HangingBucket();
layer(makeCodeModeArtifactStorageR2Layer(hangingBucket))(
  "artifact storage interruption",
  (it) => {
    it.effect("preserves interruption and does not publish a manifest", () =>
      Effect.gen(function* () {
        const storage = yield* CodeModeArtifactStorage;
        const fiber = yield* Effect.forkChild(storage.write(writeInput()));
        yield* Effect.promise(() => hangingBucket.writeStarted.promise);
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);

        if (Exit.isSuccess(exit)) {
          return assert.fail(
            "Interrupted storage write unexpectedly succeeded.",
          );
        }
        assert.isTrue(Cause.hasInterrupts(exit.cause));
        assert.isFalse(
          hangingBucket.objects.has("artifact-child/manifest.json"),
        );
      }),
    );
  },
);

it.effect("releases memory storage state when its layer scope closes", () =>
  Effect.gen(function* () {
    let releasedStorage: CodeModeArtifactStorageShape | undefined;

    yield* Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(CodeModeArtifactStorageMemory);
        const storage = Context.get(context, CodeModeArtifactStorage);
        releasedStorage = storage;
        yield* storage.write(writeInput());
        const manifest = yield* storage.readManifest("artifact-child");
        assert.isNotNull(manifest);
      }),
    );

    if (!releasedStorage) {
      return assert.fail("Memory storage layer was not acquired.");
    }
    const manifestAfterRelease =
      yield* releasedStorage.readManifest("artifact-child");
    assert.isNull(manifestAfterRelease);
  }),
);
