import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  CodeModeArtifactStorageMemory,
  makeCodeModeRuntimeEnvironmentLayer,
  type PatchableScene,
} from "@sketchi/diagram-agent";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { canonicalDocument, flowchartInput } from "./__tests__/fixtures.js";
import { DiagramBuilder, DiagramBuilderLive } from "./builder.js";
import { encodeJson } from "./document.js";
import { CliFilesystemError } from "./errors.js";
import { LocalFileSystem, localFileSystemLive } from "./filesystem.js";
import {
  DiagramPatcher,
  DiagramPatcherLive,
  decodePatchInput,
  parseJsonPatchInput,
} from "./patch.js";
import {
  DiagramStore,
  DiagramStoreLive,
  makeStorageRootLayer,
} from "./storage.js";

const testParent = resolve(process.cwd(), ".memory/cli-tests");
const validPng = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACdFJOUwAAdpPNOAAAAAJiS0dEAAHdihOkAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const runtimeLayer = Layer.mergeAll(
  CodeModeArtifactStorageMemory,
  makeCodeModeRuntimeEnvironmentLayer({
    createId: (prefix) => `${prefix}_cli_patch_test`,
  }),
);
const builderLayer = DiagramBuilderLive.pipe(Layer.provide(runtimeLayer));
const patcherLayer = DiagramPatcherLive.pipe(Layer.provide(runtimeLayer));

function storeLayer(
  root: string,
  filesystem: (typeof LocalFileSystem)["Service"] = localFileSystemLive,
) {
  return Layer.fresh(DiagramStoreLive).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(LocalFileSystem, filesystem),
        makeStorageRootLayer(root),
      ),
    ),
  );
}

function withTestRoot<A, E, R>(
  use: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.promise(async () => {
      await mkdir(testParent, { recursive: true });
      return mkdtemp(join(testParent, "patch-"));
    }),
    use,
    (root) => Effect.promise(() => rm(root, { force: true, recursive: true })),
  );
}

async function snapshotTree(root: string): Promise<ReadonlyArray<unknown>> {
  const entries: Array<unknown> = [];
  const visit = async (directory: string, prefix = ""): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const path = join(directory, child.name);
      const relativePath = join(prefix, child.name);
      if (child.isDirectory()) {
        entries.push([relativePath, "directory"]);
        await visit(path, relativePath);
      } else {
        entries.push([relativePath, await readFile(path)]);
      }
    }
  };
  await visit(root);
  return entries;
}

const selectedStyle = {
  operations: [
    {
      op: "setStyle" as const,
      selector: { nodeIds: ["review"] },
      style: {
        fillColor: "#dbeafe",
        strokeColor: "#2563eb",
      },
    },
  ],
};

describe("patch input", () => {
  it.effect("decodes the supported operation vocabulary", () =>
    Effect.gen(function* () {
      const decoded = yield* decodePatchInput({
        operations: [
          ...selectedStyle.operations,
          {
            op: "setDefaultStyle",
            style: { textColor: "#111827" },
          },
          {
            op: "setShape",
            selector: { nodeIds: ["review"] },
            shape: "ellipse",
          },
          {
            op: "translate",
            selector: { nodeIds: ["review"] },
            dx: 8,
            dy: 4,
          },
          {
            op: "replaceText",
            selector: { nodeIds: ["review"] },
            text: "Inspect evidence",
          },
          { op: "rerouteEdges" },
        ],
        intent: "Color and refine the review step.",
      });

      assert.deepStrictEqual(
        decoded.operations.map((operation) => operation.op),
        [
          "setStyle",
          "setDefaultStyle",
          "setShape",
          "translate",
          "replaceText",
          "rerouteEdges",
        ],
      );
    }),
  );

  for (const [label, input] of [
    ["unknown operation", { operations: [{ op: "setText" }] }],
    [
      "invalid color",
      {
        operations: [
          {
            op: "setStyle",
            selector: { nodeIds: ["review"] },
            style: { fillColor: "blue" },
          },
        ],
      },
    ],
    ["empty operations", { operations: [] }],
    [
      "caller source",
      {
        source: { artifactId: "hosted" },
        operations: [{ op: "rerouteEdges" }],
      },
    ],
    [
      "caller request id",
      {
        requestId: "caller-owned",
        operations: [{ op: "rerouteEdges" }],
      },
    ],
  ] as const) {
    it.effect(`rejects ${label}`, () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(decodePatchInput(input));
        assert.strictEqual(error._tag, "CliValidationError");
      }),
    );
  }

  it.effect("maps malformed JSON to the stable input error", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(parseJsonPatchInput("{"));
      assert.strictEqual(error._tag, "CliInputError");
      if (error._tag === "CliInputError") {
        assert.strictEqual(error.code, "invalid_json");
      }
    }),
  );
});

describe("offline semantic patch workflow", () => {
  it.effect(
    "changes only selected node styling and leaves labels unchanged",
    () =>
      Effect.gen(function* () {
        const builder = yield* DiagramBuilder;
        const patcher = yield* DiagramPatcher;
        const built = yield* builder.build(canonicalDocument(flowchartInput));
        const before = structuredClone(built.scene);
        const patched = yield* patcher.patch(
          built.scene,
          selectedStyle,
          "selective-style",
        );

        const selected = patched.scene.elements.find(
          (element) => element.type === "node" && element.nodeId === "review",
        );
        assert.deepInclude(selected, {
          fillColor: "#dbeafe",
          strokeColor: "#2563eb",
        });
        assert.strictEqual(
          JSON.stringify(
            patched.scene.elements.filter(
              (element) => element.type === "text" || element.type === "arrow",
            ),
          ),
          JSON.stringify(
            before.elements.filter(
              (element) => element.type === "text" || element.type === "arrow",
            ),
          ),
        );
        assert.strictEqual(
          JSON.stringify(
            patched.scene.elements.find(
              (element) =>
                element.type === "node" && element.nodeId === "start",
            ),
          ),
          JSON.stringify(
            before.elements.find(
              (element) =>
                element.type === "node" && element.nodeId === "start",
            ),
          ),
        );
      }).pipe(Effect.provide(Layer.mergeAll(builderLayer, patcherLayer))),
  );

  it.effect(
    "commits coherent artifacts, blocks edit, supports repatch, and restores canonical authority",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const builder = yield* DiagramBuilder;
          const patcher = yield* DiagramPatcher;
          const store = yield* DiagramStore;
          const built = yield* builder.build(canonicalDocument(flowchartInput));
          yield* store.create({ ...built, png: validPng });
          const documentBefore = yield* Effect.promise(() =>
            readFile(join(root, "release-flow/document.json")),
          );

          const source = yield* store.readPatchSource("release-flow");
          const artifacts = yield* patcher.patch(
            source.scene,
            selectedStyle,
            "persist-style",
          );
          const committed = yield* store.commitPatch(
            "release-flow",
            source.revision,
            artifacts,
          );
          const shown = yield* store.show("release-flow");

          assert.strictEqual(committed.manifest.revision, 2);
          assert.strictEqual(shown.authority, "patched");
          assert.isFalse(shown.documentAuthoritative);
          assert.deepStrictEqual(shown.manifest.formats, [
            "scene",
            "excalidraw",
          ]);
          assert.deepStrictEqual(shown.revisions, ["000001/"]);
          assert.strictEqual(
            yield* localFileSystemLive.kind(
              join(root, "release-flow/diagram.png"),
            ),
            "missing",
          );
          assert.strictEqual(
            yield* localFileSystemLive.kind(
              join(root, "release-flow/revisions/000001/diagram.png"),
            ),
            "file",
          );
          assert.deepStrictEqual(
            yield* Effect.promise(() =>
              readFile(join(root, "release-flow/document.json")),
            ),
            documentBefore,
          );

          const scene = JSON.parse(
            yield* Effect.promise(() =>
              readFile(join(root, "release-flow/scene.json"), "utf8"),
            ),
          ) as PatchableScene;
          const excalidraw = JSON.parse(
            yield* Effect.promise(() =>
              readFile(join(root, "release-flow/diagram.excalidraw"), "utf8"),
            ),
          ) as { elements: Array<Record<string, unknown>> };
          assert.deepInclude(
            scene.elements.find(
              (element) =>
                element.type === "node" && element.nodeId === "review",
            ),
            { fillColor: "#dbeafe", strokeColor: "#2563eb" },
          );
          assert.deepInclude(
            excalidraw.elements.find(
              (element) => element["id"] === "node:review",
            ),
            { backgroundColor: "#dbeafe", strokeColor: "#2563eb" },
          );

          const editError = yield* Effect.flip(
            store.edit("release-flow", built),
          );
          assert.strictEqual(editError._tag, "CliStorageError");
          if (editError._tag === "CliStorageError") {
            assert.strictEqual(editError.code, "detached_edit");
            assert.include(editError.hint, "Restore a canonical revision");
          }

          const conflict = yield* Effect.flip(
            store.commitPatch("release-flow", source.revision, artifacts),
          );
          assert.strictEqual(conflict._tag, "CliStorageError");
          if (conflict._tag === "CliStorageError") {
            assert.strictEqual(conflict.code, "patch_conflict");
          }
          assert.strictEqual(
            (yield* store.show("release-flow")).manifest.revision,
            2,
          );

          const secondSource = yield* store.readPatchSource("release-flow");
          const secondArtifacts = yield* patcher.patch(
            secondSource.scene,
            {
              operations: [
                {
                  op: "setStyle",
                  selector: { nodeIds: ["start"] },
                  style: { fillColor: "#dcfce7" },
                },
              ],
            },
            "repatch",
          );
          yield* store.commitPatch(
            "release-flow",
            secondSource.revision,
            secondArtifacts,
          );

          const restoredPatched = yield* store.restore("release-flow", 2);
          assert.strictEqual(restoredPatched.diagram.authority, "patched");
          assert.isFalse(restoredPatched.diagram.documentAuthoritative);
          assert.deepStrictEqual(restoredPatched.diagram.manifest.formats, [
            "scene",
            "excalidraw",
          ]);

          const restored = yield* store.restore("release-flow", 1);
          assert.strictEqual(restored.diagram.authority, "canonical");
          assert.isTrue(restored.diagram.documentAuthoritative);
          assert.deepStrictEqual(restored.diagram.manifest.formats, [
            "scene",
            "excalidraw",
            "png",
          ]);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(builderLayer, patcherLayer, storeLayer(root)),
          ),
        ),
      ),
  );

  it.effect("rejects detached records without a current patchable scene", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const builder = yield* DiagramBuilder;
        const store = yield* DiagramStore;
        const built = yield* builder.build(canonicalDocument(flowchartInput));
        yield* store.create(built);
        yield* store.replaceWithDetached(
          "release-flow",
          new TextEncoder().encode(encodeJson(built.excalidraw)),
        );

        const error = yield* Effect.flip(store.readPatchSource("release-flow"));
        assert.strictEqual(error._tag, "CliStorageError");
        if (error._tag === "CliStorageError") {
          assert.strictEqual(error.code, "patch_source_unavailable");
        }
      }).pipe(Effect.provide(Layer.mergeAll(builderLayer, storeLayer(root)))),
    ),
  );

  it.effect(
    "leaves the record byte-for-byte unchanged after validation and conversion failures",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const builder = yield* DiagramBuilder;
          const patcher = yield* DiagramPatcher;
          const store = yield* DiagramStore;
          const built = yield* builder.build(canonicalDocument(flowchartInput));
          yield* store.create(built);
          const record = join(root, "release-flow");
          const before = yield* Effect.promise(() => snapshotTree(record));
          const source = yield* store.readPatchSource("release-flow");

          yield* Effect.flip(
            patcher.patch(
              source.scene,
              {
                operations: [
                  {
                    op: "setStyle",
                    selector: { nodeIds: ["missing"] },
                    style: { fillColor: "#dbeafe" },
                  },
                ],
              },
              "missing-target",
            ),
          );
          assert.deepStrictEqual(
            yield* Effect.promise(() => snapshotTree(record)),
            before,
          );

          const broken = structuredClone(source.scene);
          const arrow = broken.elements.find(
            (element) => element.type === "arrow",
          );
          if (!arrow || arrow.type !== "arrow") return assert.fail("no arrow");
          arrow.targetNodeId = "missing-node";
          const conversionError = yield* Effect.flip(
            patcher.patch(broken, selectedStyle, "conversion-failure"),
          );
          assert.strictEqual(conversionError._tag, "CliBuildError");
          assert.deepStrictEqual(
            yield* Effect.promise(() => snapshotTree(record)),
            before,
          );
        }).pipe(
          Effect.provide(
            Layer.mergeAll(builderLayer, patcherLayer, storeLayer(root)),
          ),
        ),
      ),
  );

  it.effect(
    "rolls a failed patch storage commit back without a partial revision",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const builder = yield* DiagramBuilder;
          const patcher = yield* DiagramPatcher;
          const baseStore = yield* DiagramStore;
          const built = yield* builder.build(canonicalDocument(flowchartInput));
          yield* baseStore.create(built);
          const record = join(root, "release-flow");
          const before = yield* Effect.promise(() => snapshotTree(record));
          const source = yield* baseStore.readPatchSource("release-flow");
          const artifacts = yield* patcher.patch(
            source.scene,
            selectedStyle,
            "storage-failure",
          );
          const failingFilesystem: (typeof LocalFileSystem)["Service"] = {
            ...localFileSystemLive,
            rename: (from, to) =>
              from.includes("/.stage.") && to === record
                ? Effect.fail(
                    CliFilesystemError.make({
                      cause: new Error("injected patch commit failure"),
                      operation: "rename",
                      path: `${from} -> ${to}`,
                      message: "Injected patch commit failure.",
                    }),
                  )
                : localFileSystemLive.rename(from, to),
          };
          const failure = yield* Effect.gen(function* () {
            const store = yield* DiagramStore;
            return yield* Effect.flip(
              store.commitPatch("release-flow", source.revision, artifacts),
            );
          }).pipe(Effect.provide(storeLayer(root, failingFilesystem)));

          assert.strictEqual(failure._tag, "CliFilesystemError");
          assert.deepStrictEqual(
            yield* Effect.promise(() => snapshotTree(record)),
            before,
          );
          assert.strictEqual(
            (yield* baseStore.show("release-flow")).manifest.revision,
            1,
          );
        }).pipe(
          Effect.provide(
            Layer.mergeAll(builderLayer, patcherLayer, storeLayer(root)),
          ),
        ),
      ),
  );
});
