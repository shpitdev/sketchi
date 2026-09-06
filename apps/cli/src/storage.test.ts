import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import { CanvasSpec } from "@sketchi/diagram-agent";
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Ref, Schema } from "effect";
import { FastCheck, TestClock } from "effect/testing";

import { type BuiltDiagram } from "./contracts.js";
import { CliFilesystemError, exitCodeForFailure } from "./errors.js";
import { LocalFileSystem, localFileSystemLive } from "./filesystem.js";
import {
  DiagramStore,
  DiagramStoreLive,
  makeStorageRootLayer,
  writeExportFile,
} from "./storage.js";
import { builtDiagram, canonicalDocument } from "./__tests__/fixtures.js";

const testParent = resolve(process.cwd(), ".memory/cli-tests");
const validPng = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACdFJOUwAAdpPNOAAAAAJiS0dEAAHdihOkAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zeroWidthPng(): Uint8Array {
  const bytes = Uint8Array.from(validPng);
  bytes.fill(0, 16, 20);
  new DataView(bytes.buffer).setUint32(29, crc32(bytes.subarray(12, 29)));
  return bytes;
}

function oversizedWidthPng(): Uint8Array {
  const bytes = Uint8Array.from(validPng);
  new DataView(bytes.buffer).setUint32(16, 0x80000000);
  new DataView(bytes.buffer).setUint32(29, crc32(bytes.subarray(12, 29)));
  return bytes;
}

function oversizedHeightPng(): Uint8Array {
  const bytes = Uint8Array.from(validPng);
  new DataView(bytes.buffer).setUint32(20, 0x80000000);
  new DataView(bytes.buffer).setUint32(29, crc32(bytes.subarray(12, 29)));
  return bytes;
}

function illegalChunkTypePng(
  byteIndex: number,
  replacement = 0x31,
): Uint8Array {
  const bytes = Uint8Array.from(validPng);
  const chunkTypeOffset = 37;
  bytes[chunkTypeOffset + byteIndex] = replacement;
  const chunkLength = new DataView(bytes.buffer).getUint32(chunkTypeOffset - 4);
  const chunkCrcOffset = chunkTypeOffset + 4 + chunkLength;
  new DataView(bytes.buffer).setUint32(
    chunkCrcOffset,
    crc32(bytes.subarray(chunkTypeOffset, chunkCrcOffset)),
  );
  return bytes;
}

function invalidIdatPng(): Uint8Array {
  const bytes = Uint8Array.from(validPng);
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const view = new DataView(bytes.buffer);
    const length = view.getUint32(offset);
    const typeOffset = offset + 4;
    const type = String.fromCharCode(
      bytes[typeOffset]!,
      bytes[typeOffset + 1]!,
      bytes[typeOffset + 2]!,
      bytes[typeOffset + 3]!,
    );
    if (type === "IDAT") {
      bytes[typeOffset + 4] = 0;
      bytes[typeOffset + 5] = 0;
      const crcOffset = typeOffset + 4 + length;
      view.setUint32(crcOffset, crc32(bytes.subarray(typeOffset, crcOffset)));
      return bytes;
    }
    offset += length + 12;
  }
  throw new Error("validPng fixture has no IDAT chunk");
}

function pngWithTrailingIdatBytes(): Uint8Array {
  let offset = 8;
  while (offset + 12 <= validPng.byteLength) {
    const length = new DataView(validPng.buffer).getUint32(offset);
    const typeOffset = offset + 4;
    const type = String.fromCharCode(
      validPng[typeOffset]!,
      validPng[typeOffset + 1]!,
      validPng[typeOffset + 2]!,
      validPng[typeOffset + 3]!,
    );
    if (type === "IDAT") {
      const dataEnd = typeOffset + 4 + length;
      const trailingBytes = Uint8Array.from([1, 2, 3, 4]);
      const bytes = new Uint8Array(validPng.byteLength + trailingBytes.length);
      bytes.set(validPng.subarray(0, dataEnd));
      bytes.set(trailingBytes, dataEnd);
      bytes.set(validPng.subarray(dataEnd), dataEnd + trailingBytes.length);
      const view = new DataView(bytes.buffer);
      view.setUint32(offset, length + trailingBytes.length);
      const crcOffset = dataEnd + trailingBytes.length;
      view.setUint32(crcOffset, crc32(bytes.subarray(typeOffset, crcOffset)));
      return bytes;
    }
    offset += length + 12;
  }
  throw new Error("validPng fixture has no IDAT chunk");
}

async function snapshotTree(root: string): Promise<ReadonlyArray<unknown>> {
  const entries: Array<unknown> = [];
  const visit = async (directory: string, prefix = ""): Promise<void> => {
    const directoryEntries = await readdir(directory, { withFileTypes: true });
    directoryEntries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of directoryEntries) {
      const relativePath = join(prefix, entry.name);
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
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

function detachedBytes(revision = 1): Uint8Array {
  return new TextEncoder().encode(
    `${JSON.stringify({
      ...builtDiagram().excalidraw,
      source: `https://sketchi.dev/detached/${String(revision)}`,
    })}\n`,
  );
}

function withTestRoot<A, E, R>(
  use: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | CliFilesystemError, R> {
  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: async () => {
        await mkdir(testParent, { recursive: true });
        return mkdtemp(join(testParent, "storage-"));
      },
      catch: (cause) =>
        CliFilesystemError.make({
          cause,
          operation: "make-test-directory",
          path: testParent,
          message: "Unable to create storage test directory.",
        }),
    }),
    use,
    (root) => Effect.promise(() => rm(root, { force: true, recursive: true })),
  );
}

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

function exportFileLayer(root: string) {
  return Layer.mergeAll(
    Layer.succeed(LocalFileSystem, localFileSystemLive),
    makeStorageRootLayer(root),
  );
}

function storageFailure(operation: string, path: string) {
  return CliFilesystemError.make({
    cause: new Error("injected storage failure"),
    operation,
    path,
    message: `Injected ${operation} failure.`,
  });
}

describe("diagram storage", () => {
  it.effect("migrates manifests without authority as canonical records", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const store = yield* DiagramStore;
        yield* store.create(builtDiagram());
        const manifestPath = join(root, "release-flow", "manifest.json");
        const manifest = JSON.parse(
          yield* Effect.promise(() => readFile(manifestPath, "utf8")),
        );
        delete manifest.authority;
        yield* Effect.promise(() =>
          writeFile(manifestPath, `${JSON.stringify(manifest)}\n`),
        );

        const shown = yield* store.show("release-flow");
        const listed = yield* store.list();
        assert.strictEqual(shown.authority, "canonical");
        assert.isTrue(shown.documentAuthoritative);
        assert.strictEqual(listed[0]?.authority, "canonical");
        assert.isTrue(listed[0]?.documentAuthoritative);
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );

  it.effect("atomically creates the complete versioned record layout", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const store = yield* DiagramStore;
        const created = yield* store.create(builtDiagram());

        assert.strictEqual(created.manifest.schemaVersion, 1);
        assert.strictEqual(created.manifest.revision, 1);
        assert.deepStrictEqual(created.manifest.formats, [
          "scene",
          "excalidraw",
        ]);
        assert.deepStrictEqual(
          (yield* Effect.promise(() =>
            readdir(join(root, "release-flow")),
          )).sort(),
          [
            "diagram.excalidraw",
            "document.json",
            "manifest.json",
            "revisions",
            "scene.json",
          ],
        );
        assert.deepStrictEqual(
          yield* Effect.promise(() =>
            readdir(join(root, "release-flow", "revisions")),
          ),
          [],
        );
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );

  it.effect(
    "round-trips a Universal Canvas record through the shared store",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const store = yield* DiagramStore;
          const spec = Schema.decodeUnknownSync(CanvasSpec)({
            kind: "canvas",
            version: 1,
            diagramId: "stored-canvas",
            title: "Stored Canvas",
            width: 480,
            height: 320,
            accentColor: "#2563eb",
            backgroundColor: "#ffffff",
            elements: [
              {
                type: "text",
                id: "heading",
                x: 40,
                y: 40,
                text: "Stored Canvas",
                fontSize: 28,
              },
            ],
            layers: [],
            layouts: [],
            zOrder: ["heading"],
          });
          const diagram: BuiltDiagram = {
            id: spec.diagramId,
            type: "canvas",
            title: spec.title,
            document: { type: "canvas", spec },
            scene: spec,
            excalidraw: builtDiagram().excalidraw,
          };

          const created = yield* store.create(diagram);
          const shown = yield* store.show(spec.diagramId);

          assert.strictEqual(created.manifest.type, "canvas");
          assert.strictEqual(shown.document.type, "canvas");
          assert.deepStrictEqual(shown.document, diagram.document);
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect(
    "preserves each prior canonical document as a recoverable revision",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const store = yield* DiagramStore;
          yield* store.create(builtDiagram());
          yield* store.edit(
            "release-flow",
            builtDiagram({ title: "Release approval revised" }),
          );
          const edited = yield* store.show("release-flow");
          const revision = JSON.parse(
            yield* Effect.promise(() =>
              readFile(
                join(root, "release-flow/revisions/000001/document.json"),
                "utf8",
              ),
            ),
          );

          assert.strictEqual(edited.manifest.revision, 2);
          assert.strictEqual(
            edited.document.spec.title,
            "Release approval revised",
          );
          assert.deepStrictEqual(edited.revisions, ["000001/"]);
          assert.strictEqual(revision.spec.title, "Release approval");
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect(
    "atomically detaches a record and preserves full byte snapshots",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const store = yield* DiagramStore;
          yield* store.create(builtDiagram({ png: validPng }));
          const record = join(root, "release-flow");
          const original = new Map<string, Uint8Array>();
          for (const file of [
            "manifest.json",
            "document.json",
            "scene.json",
            "diagram.excalidraw",
            "diagram.png",
          ]) {
            original.set(
              file,
              new Uint8Array(
                yield* Effect.promise(() => readFile(join(record, file))),
              ),
            );
          }

          const replacement = detachedBytes();
          const detached = yield* store.replaceWithDetached(
            "release-flow",
            replacement,
          );
          assert.strictEqual(detached.manifest.revision, 2);
          assert.strictEqual(detached.authority, "detached");
          assert.isFalse(detached.documentAuthoritative);
          assert.deepStrictEqual(detached.manifest.formats, ["excalidraw"]);
          assert.deepStrictEqual(detached.revisions, ["000001/"]);
          assert.strictEqual(
            yield* localFileSystemLive.kind(join(record, "diagram.png")),
            "missing",
          );
          for (const [file, bytes] of original) {
            assert.deepStrictEqual(
              new Uint8Array(
                yield* Effect.promise(() =>
                  readFile(join(record, "revisions", "000001", file)),
                ),
              ),
              bytes,
            );
          }

          const editError = yield* Effect.flip(
            store.edit("release-flow", builtDiagram({ title: "Rejected" })),
          );
          assert.strictEqual(editError._tag, "CliStorageError");
          if (editError._tag === "CliStorageError") {
            assert.strictEqual(editError.code, "detached_edit");
          }
          const sceneError = yield* Effect.flip(
            store.readExportSource("release-flow", "scene"),
          );
          assert.strictEqual(sceneError._tag, "CliExportError");
          const png = yield* store.readExportSource("release-flow", "png");
          assert.strictEqual(png._tag, "RenderPng");
          if (png._tag === "RenderPng") {
            assert.isUndefined(png.scene);
            assert.deepStrictEqual(png.excalidraw, replacement);
          }
          const restored = yield* store.restore("release-flow", 1);
          assert.strictEqual(restored.diagram.authority, "canonical");
          assert.deepStrictEqual(restored.diagram.manifest.formats, [
            "scene",
            "excalidraw",
            "png",
          ]);
          assert.deepStrictEqual(
            new Uint8Array(
              yield* Effect.promise(() =>
                readFile(join(record, "diagram.png")),
              ),
            ),
            validPng,
          );
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect(
    "supports repeated detached replacements with monotonic full snapshots",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const store = yield* DiagramStore;
          yield* store.create(builtDiagram());
          const first = detachedBytes(1);
          const second = detachedBytes(2);
          yield* store.replaceWithDetached("release-flow", first);
          const replaced = yield* store.replaceWithDetached(
            "release-flow",
            second,
          );

          assert.strictEqual(replaced.manifest.revision, 3);
          assert.deepStrictEqual(replaced.revisions, ["000001/", "000002/"]);
          assert.deepStrictEqual(
            new Uint8Array(
              yield* Effect.promise(() =>
                readFile(
                  join(
                    root,
                    "release-flow/revisions/000002/diagram.excalidraw",
                  ),
                ),
              ),
            ),
            first,
          );
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect(
    "rejects a pulled replacement when the observed revision changed",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const store = yield* DiagramStore;
          yield* store.create(builtDiagram());
          yield* store.edit("release-flow", builtDiagram({ title: "Newer" }));

          const failure = yield* Effect.flip(
            store.replaceWithDetached("release-flow", detachedBytes(), 1),
          );
          assert.strictEqual(failure._tag, "CliStorageError");
          if (failure._tag === "CliStorageError") {
            assert.strictEqual(failure.code, "replacement_conflict");
          }
          const unchanged = yield* store.show("release-flow");
          assert.strictEqual(unchanged.manifest.revision, 2);
          assert.strictEqual(unchanged.authority, "canonical");
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect(
    "restores canonical and detached snapshots without consuming them",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const store = yield* DiagramStore;
          yield* store.create(builtDiagram());
          const first = detachedBytes(1);
          const second = detachedBytes(2);
          yield* store.replaceWithDetached("release-flow", first);
          yield* store.replaceWithDetached("release-flow", second);

          const canonical = yield* store.restore("release-flow", 1);
          assert.strictEqual(canonical.restoredFromRevision, 1);
          assert.strictEqual(canonical.diagram.manifest.revision, 4);
          assert.strictEqual(canonical.diagram.authority, "canonical");
          assert.deepStrictEqual(canonical.diagram.revisions, [
            "000001/",
            "000002/",
            "000003/",
          ]);

          const detached = yield* store.restore("release-flow", 2);
          assert.strictEqual(detached.diagram.manifest.revision, 5);
          assert.strictEqual(detached.diagram.authority, "detached");
          const source = yield* store.readExportSource(
            "release-flow",
            "excalidraw",
          );
          assert.strictEqual(source._tag, "StoredArtifact");
          if (source._tag === "StoredArtifact") {
            assert.deepStrictEqual(source.bytes, first);
          }
          assert.strictEqual(
            yield* localFileSystemLive.kind(
              join(root, "release-flow/revisions/000001"),
            ),
            "directory",
          );
          assert.deepStrictEqual(
            new Uint8Array(
              yield* Effect.promise(() =>
                readFile(
                  join(
                    root,
                    "release-flow/revisions/000004/diagram.excalidraw",
                  ),
                ),
              ),
            ),
            new Uint8Array(
              yield* Effect.promise(() =>
                readFile(
                  join(
                    root,
                    "release-flow/revisions/000001/diagram.excalidraw",
                  ),
                ),
              ),
            ),
          );
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect("preserves archived bytes except the manifest revision value", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const store = yield* DiagramStore;
        yield* store.create(builtDiagram());
        yield* store.replaceWithDetached("release-flow", detachedBytes());
        const snapshot = join(root, "release-flow/revisions/000001");
        const legacyManifest = `{
  "schemaVersion": 1,
  "id": "release-flow",
  "type": "flowchart",
  "title": "Release approval",
  "revision" : 1,
  "formats": [ "scene", "excalidraw" ]
}
`;
        yield* Effect.promise(() =>
          writeFile(join(snapshot, "manifest.json"), legacyManifest),
        );
        const archivedFiles = [
          "document.json",
          "scene.json",
          "diagram.excalidraw",
        ];
        const archivedBytes = new Map(
          yield* Effect.promise(() =>
            Promise.all(
              archivedFiles.map(
                async (file) =>
                  [file, await readFile(join(snapshot, file))] as const,
              ),
            ),
          ),
        );

        const restored = yield* store.restore("release-flow", 1);
        assert.strictEqual(restored.diagram.manifest.revision, 3);
        assert.strictEqual(restored.diagram.authority, "canonical");
        assert.strictEqual(
          yield* Effect.promise(() =>
            readFile(join(root, "release-flow/manifest.json"), "utf8"),
          ),
          legacyManifest.replace('"revision" : 1', '"revision" : 3'),
        );
        for (const [file, bytes] of archivedBytes) {
          assert.deepStrictEqual(
            yield* Effect.promise(() =>
              readFile(join(root, "release-flow", file)),
            ),
            bytes,
          );
        }
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );

  it.effect("enumerates and restores mixed legacy and full revisions", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const store = yield* DiagramStore;
        yield* store.create(builtDiagram());
        const record = join(root, "release-flow");
        yield* Effect.promise(async () => {
          await writeFile(
            join(record, "revisions/000001.json"),
            await readFile(join(record, "document.json")),
          );
          const manifest = JSON.parse(
            await readFile(join(record, "manifest.json"), "utf8"),
          );
          manifest.revision = 2;
          await writeFile(
            join(record, "manifest.json"),
            `${JSON.stringify(manifest)}\n`,
          );
        });
        const legacy = yield* store.readRevision("release-flow", 1);
        assert.strictEqual(legacy._tag, "LegacyDocument");
        if (legacy._tag !== "LegacyDocument") return;
        const restored = yield* store.restore(
          "release-flow",
          1,
          builtDiagram({ document: legacy.document }),
        );
        assert.strictEqual(restored.diagram.manifest.revision, 3);
        assert.strictEqual(restored.diagram.authority, "canonical");
        assert.strictEqual(
          restored.diagram.document.spec.title,
          "Release approval",
        );
        assert.deepStrictEqual(restored.diagram.revisions, [
          "000001.json",
          "000002/",
        ]);
        yield* store.replaceWithDetached("release-flow", detachedBytes());
        const shown = yield* store.show("release-flow");
        assert.deepStrictEqual(shown.revisions, [
          "000001.json",
          "000002/",
          "000003/",
        ]);
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );

  it.effect("enumerates revision directories beyond six digits", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const store = yield* DiagramStore;
        yield* store.create(builtDiagram());
        const manifestPath = join(root, "release-flow/manifest.json");
        yield* Effect.promise(async () => {
          const manifest: unknown = JSON.parse(
            await readFile(manifestPath, "utf8"),
          );
          if (typeof manifest !== "object" || manifest === null) {
            throw new Error("invalid test manifest");
          }
          Object.assign(manifest, { revision: 999_999 });
          await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
        });
        yield* store.replaceWithDetached("release-flow", detachedBytes(1));
        const replaced = yield* store.replaceWithDetached(
          "release-flow",
          detachedBytes(2),
        );
        assert.strictEqual(replaced.manifest.revision, 1_000_001);
        assert.deepStrictEqual(replaced.revisions, ["999999/", "1000000/"]);
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );

  it.effect(
    "refuses missing and corrupt revisions without changing the record",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const store = yield* DiagramStore;
          yield* store.create(builtDiagram());
          const missing = yield* Effect.flip(store.restore("release-flow", 9));
          assert.strictEqual(missing._tag, "CliStorageError");
          if (missing._tag === "CliStorageError") {
            assert.strictEqual(missing.code, "revision_not_found");
          }
          yield* store.replaceWithDetached("release-flow", detachedBytes());
          yield* Effect.promise(() =>
            writeFile(
              join(root, "release-flow/revisions/000001/manifest.json"),
              "{",
            ),
          );
          const corrupt = yield* Effect.flip(store.restore("release-flow", 1));
          assert.strictEqual(corrupt._tag, "CliStorageError");
          assert.strictEqual(
            (yield* store.show("release-flow")).manifest.revision,
            2,
          );
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect("rolls a failed restore commit back to the displaced state", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const baseStore = yield* DiagramStore;
        yield* baseStore.create(builtDiagram());
        const replacement = detachedBytes();
        yield* baseStore.replaceWithDetached("release-flow", replacement);
        const failingFilesystem: (typeof LocalFileSystem)["Service"] = {
          ...localFileSystemLive,
          rename: (source, destination) =>
            source.includes("/.stage.") &&
            destination === join(root, "release-flow")
              ? Effect.fail(
                  storageFailure("rename", `${source} -> ${destination}`),
                )
              : localFileSystemLive.rename(source, destination),
        };
        const failed = yield* Effect.gen(function* () {
          const store = yield* DiagramStore;
          return yield* Effect.flip(store.restore("release-flow", 1));
        }).pipe(Effect.provide(storeLayer(root, failingFilesystem)));
        assert.strictEqual(failed._tag, "CliFilesystemError");

        const unchanged = yield* baseStore.show("release-flow");
        assert.strictEqual(unchanged.manifest.revision, 2);
        assert.strictEqual(unchanged.authority, "detached");
        assert.deepStrictEqual(unchanged.revisions, ["000001/"]);
        const source = yield* baseStore.readExportSource(
          "release-flow",
          "excalidraw",
        );
        assert.strictEqual(source._tag, "StoredArtifact");
        if (source._tag === "StoredArtifact") {
          assert.deepStrictEqual(source.bytes, replacement);
        }
        assert.strictEqual(
          yield* localFileSystemLive.kind(
            join(root, "release-flow/revisions/000002"),
          ),
          "missing",
        );
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );

  it.effect("rejects corrupt archived artifact bytes before restore", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const store = yield* DiagramStore;
        yield* store.create(builtDiagram());
        yield* store.replaceWithDetached("release-flow", detachedBytes());
        yield* Effect.promise(() =>
          writeFile(
            join(root, "release-flow/revisions/000001/diagram.excalidraw"),
            "not-json",
          ),
        );

        const failure = yield* Effect.flip(store.restore("release-flow", 1));
        assert.strictEqual(failure._tag, "CliStorageError");
        if (failure._tag === "CliStorageError") {
          assert.strictEqual(failure.code, "corrupt_revision");
        }
        assert.strictEqual(
          (yield* store.show("release-flow")).manifest.revision,
          2,
        );
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );

  it.effect(
    "rejects structurally valid but semantically corrupt archives",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const store = yield* DiagramStore;
          yield* store.create(builtDiagram({ png: validPng }));
          yield* store.replaceWithDetached("release-flow", detachedBytes());
          const snapshot = join(root, "release-flow/revisions/000001");

          yield* Effect.promise(() =>
            writeFile(join(snapshot, "scene.json"), "{}\n"),
          );
          const invalidScene = yield* Effect.flip(
            store.restore("release-flow", 1),
          );
          assert.strictEqual(invalidScene._tag, "CliStorageError");
          if (invalidScene._tag === "CliStorageError") {
            assert.strictEqual(invalidScene.code, "corrupt_revision");
          }

          yield* Effect.promise(async () => {
            await writeFile(
              join(snapshot, "scene.json"),
              `${JSON.stringify(builtDiagram().scene)}\n`,
            );
            await writeFile(
              join(snapshot, "diagram.png"),
              new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
            );
          });
          const invalidPng = yield* Effect.flip(
            store.restore("release-flow", 1),
          );
          assert.strictEqual(invalidPng._tag, "CliStorageError");
          if (invalidPng._tag === "CliStorageError") {
            assert.strictEqual(invalidPng.code, "corrupt_revision");
          }
          for (const illegalPng of [
            zeroWidthPng(),
            oversizedWidthPng(),
            oversizedHeightPng(),
            illegalChunkTypePng(0),
            illegalChunkTypePng(1),
            illegalChunkTypePng(2),
            illegalChunkTypePng(3),
            illegalChunkTypePng(2, 0x72),
            invalidIdatPng(),
            pngWithTrailingIdatBytes(),
          ]) {
            yield* Effect.promise(() =>
              writeFile(join(snapshot, "diagram.png"), illegalPng),
            );
            const before = yield* Effect.promise(() =>
              snapshotTree(join(root, "release-flow")),
            );
            const failure = yield* Effect.flip(
              store.restore("release-flow", 1),
            );
            assert.strictEqual(failure._tag, "CliStorageError");
            if (failure._tag === "CliStorageError") {
              assert.strictEqual(failure.code, "corrupt_revision");
            }
            assert.strictEqual(exitCodeForFailure(failure), 7);
            assert.deepStrictEqual(
              yield* Effect.promise(() =>
                snapshotTree(join(root, "release-flow")),
              ),
              before,
            );
          }
          assert.strictEqual(
            (yield* store.show("release-flow")).manifest.revision,
            2,
          );
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect("rejects invalid compressed data in a current stored PNG", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const store = yield* DiagramStore;
        yield* store.create(builtDiagram({ png: validPng }));
        const record = join(root, "release-flow");
        for (const illegalPng of [
          invalidIdatPng(),
          pngWithTrailingIdatBytes(),
        ]) {
          yield* Effect.promise(() =>
            writeFile(join(record, "diagram.png"), illegalPng),
          );
          const before = yield* Effect.promise(() => snapshotTree(record));

          const failure = yield* Effect.flip(store.show("release-flow"));

          assert.strictEqual(failure._tag, "CliStorageError");
          if (failure._tag === "CliStorageError") {
            assert.strictEqual(failure.code, "corrupt_record");
          }
          assert.strictEqual(exitCodeForFailure(failure), 7);
          assert.deepStrictEqual(
            yield* Effect.promise(() => snapshotTree(record)),
            before,
          );
        }
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );

  it.effect(
    "recovers the displaced state after an interrupted restore gap",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const baseStore = yield* DiagramStore;
          yield* baseStore.create(builtDiagram());
          const replacement = detachedBytes();
          yield* baseStore.replaceWithDetached("release-flow", replacement);
          const enteredGap = yield* Deferred.make<void>();
          const record = join(root, "release-flow");
          const pausingFilesystem: (typeof LocalFileSystem)["Service"] = {
            ...localFileSystemLive,
            rename: (source, destination) =>
              source === record && destination.includes("/.backup.")
                ? localFileSystemLive.rename(source, destination).pipe(
                    Effect.tap(() => Deferred.succeed(enteredGap, undefined)),
                    Effect.andThen(Effect.never),
                  )
                : localFileSystemLive.rename(source, destination),
          };
          const writer = yield* Effect.gen(function* () {
            return yield* DiagramStore;
          }).pipe(Effect.provide(storeLayer(root, pausingFilesystem)));
          const restoreFiber = yield* writer
            .restore("release-flow", 1)
            .pipe(Effect.forkChild);
          yield* Deferred.await(enteredGap);
          yield* Fiber.interrupt(restoreFiber);

          const recovered = yield* baseStore.show("release-flow");
          assert.strictEqual(recovered.manifest.revision, 2);
          assert.strictEqual(recovered.authority, "detached");
          assert.deepStrictEqual(recovered.revisions, ["000001/"]);
          const entries = yield* Effect.promise(() => readdir(root));
          assert.isFalse(entries.some((entry) => entry.startsWith(".backup.")));
          assert.isFalse(entries.some((entry) => entry.startsWith(".stage.")));
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect("leaves no visible record when create fails before commit", () =>
    withTestRoot((root) => {
      const failingFilesystem: (typeof LocalFileSystem)["Service"] = {
        ...localFileSystemLive,
        writeText: (path, value, replace) =>
          path.endsWith("/manifest.json")
            ? Effect.fail(storageFailure("write", path))
            : localFileSystemLive.writeText(path, value, replace),
      };
      return Effect.gen(function* () {
        const store = yield* DiagramStore;
        const error = yield* Effect.flip(store.create(builtDiagram()));
        const entries = yield* Effect.promise(() => readdir(root));

        assert.strictEqual(error._tag, "CliFilesystemError");
        assert.deepStrictEqual(
          entries.filter((name) => !name.startsWith(".")),
          [],
        );
        assert.isFalse(entries.some((name) => name.startsWith(".stage.")));
      }).pipe(Effect.provide(storeLayer(root, failingFilesystem)));
    }),
  );

  it.effect(
    "does not wedge storage when owner publication is only partially written",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          let failOwnerPublication = true;
          const failingFilesystem: (typeof LocalFileSystem)["Service"] = {
            ...localFileSystemLive,
            writeText: (path, value, replace) => {
              if (
                failOwnerPublication &&
                (path.includes(".lock/owner.") ||
                  path.includes(".lock/.owner-candidate."))
              ) {
                failOwnerPublication = false;
                return localFileSystemLive
                  .writeText(path, "{")
                  .pipe(
                    Effect.andThen(Effect.fail(storageFailure("write", path))),
                  );
              }
              return localFileSystemLive.writeText(path, value, replace);
            },
          };
          const failingStore = yield* Effect.gen(function* () {
            return yield* DiagramStore;
          }).pipe(Effect.provide(storeLayer(root, failingFilesystem)));
          const baseStore = yield* DiagramStore;

          const error = yield* Effect.flip(failingStore.create(builtDiagram()));
          const created = yield* baseStore.create(builtDiagram());
          const shown = yield* baseStore.show("release-flow");

          assert.strictEqual(error._tag, "CliFilesystemError");
          assert.strictEqual(created.manifest.revision, 1);
          assert.strictEqual(shown.manifest.revision, 1);
          const lockEntries = yield* Effect.promise(() =>
            readdir(
              join(
                root,
                ".locks",
                `${Buffer.from("release-flow", "utf8").toString("base64url")}.lock`,
              ),
            ),
          );
          assert.isFalse(
            lockEntries.some((entry) => entry.startsWith(".owner-candidate.")),
          );
          assert.isFalse(
            lockEntries.some((entry) => entry.startsWith("owner.")),
          );
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect(
    "recovers an unpublished partial owner left by process termination",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const store = yield* DiagramStore;
          yield* store.create(builtDiagram());
          const lockDirectory = join(
            root,
            ".locks",
            `${Buffer.from("release-flow", "utf8").toString("base64url")}.lock`,
          );
          const candidatePath = join(
            lockDirectory,
            ".owner-candidate.interrupted.json",
          );
          yield* Effect.promise(() => writeFile(candidatePath, "{"));

          const shown = yield* store.show("release-flow");

          assert.strictEqual(shown.manifest.revision, 1);
          assert.strictEqual(
            yield* localFileSystemLive.kind(candidatePath),
            "missing",
          );
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect(
    "does not replace or delete an owner published before the atomic link",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          let replacementOwnerPath: string | undefined;
          let replacementOwnerToken: string | undefined;
          const racingFilesystem: (typeof LocalFileSystem)["Service"] = {
            ...localFileSystemLive,
            writeText: (path, value, replace) => {
              const match = /\/\.owner-candidate\.([a-zA-Z0-9_-]+)\.json$/.exec(
                path,
              );
              if (!match || replacementOwnerPath) {
                return localFileSystemLive.writeText(path, value, replace);
              }
              const token = match[1];
              if (!token) {
                return Effect.fail(storageFailure("parse-token", path));
              }
              replacementOwnerPath = join(
                path.slice(0, path.lastIndexOf("/")),
                `owner.${token}.json`,
              );
              replacementOwnerToken = token;
              return localFileSystemLive.writeText(path, value, replace).pipe(
                Effect.andThen(
                  localFileSystemLive.writeText(
                    replacementOwnerPath,
                    `${JSON.stringify({
                      pid: process.pid,
                      replacement: true,
                      token,
                    })}\n`,
                  ),
                ),
              );
            },
          };
          const racingStore = yield* Effect.gen(function* () {
            return yield* DiagramStore;
          }).pipe(Effect.provide(storeLayer(root, racingFilesystem)));
          const baseStore = yield* DiagramStore;

          const error = yield* Effect.flip(racingStore.create(builtDiagram()));
          assert.strictEqual(error._tag, "CliStorageError");
          if (error._tag === "CliStorageError") {
            assert.strictEqual(error.code, "diagram_busy");
          }
          assert.isDefined(replacementOwnerPath);
          assert.isDefined(replacementOwnerToken);
          if (!replacementOwnerPath || !replacementOwnerToken) return;
          const ownerPath = replacementOwnerPath;
          assert.deepStrictEqual(
            JSON.parse(
              yield* Effect.promise(() => readFile(ownerPath, "utf8")),
            ),
            {
              pid: process.pid,
              replacement: true,
              token: replacementOwnerToken,
            },
          );

          yield* localFileSystemLive.removeFile(ownerPath);
          const created = yield* baseStore.create(builtDiagram());
          assert.strictEqual(created.manifest.revision, 1);
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect(
    "returns diagram_busy when a contender reclaims its unpublished owner",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const publicationPaused = yield* Deferred.make<string>();
          const resumePublication = yield* Deferred.make<void>();
          let pauseNextPublication = true;
          const pausingFilesystem: (typeof LocalFileSystem)["Service"] = {
            ...localFileSystemLive,
            tryLinkFile: (source, destination) => {
              if (
                !pauseNextPublication ||
                !source.includes("/.owner-candidate.")
              ) {
                return localFileSystemLive.tryLinkFile(source, destination);
              }
              pauseNextPublication = false;
              return Deferred.succeed(publicationPaused, source).pipe(
                Effect.andThen(Deferred.await(resumePublication)),
                Effect.andThen(
                  localFileSystemLive.tryLinkFile(source, destination),
                ),
              );
            },
          };
          const pausedStore = yield* Effect.gen(function* () {
            return yield* DiagramStore;
          }).pipe(Effect.provide(storeLayer(root, pausingFilesystem)));
          const baseStore = yield* DiagramStore;

          const losingFiber = yield* Effect.forkChild(
            Effect.flip(pausedStore.create(builtDiagram())),
          );
          const candidatePath = yield* Deferred.await(publicationPaused);
          const created = yield* baseStore.create(builtDiagram());

          assert.strictEqual(created.manifest.revision, 1);
          assert.strictEqual(
            yield* localFileSystemLive.kind(candidatePath),
            "missing",
          );
          yield* Deferred.succeed(resumePublication, undefined);
          const error = yield* Fiber.join(losingFiber);
          assert.strictEqual(error._tag, "CliStorageError");
          if (error._tag === "CliStorageError") {
            assert.strictEqual(error.code, "diagram_busy");
          }
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect(
    "returns a committed create once when writing its release marker fails",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          let failReleaseMarker = true;
          const failingFilesystem: (typeof LocalFileSystem)["Service"] = {
            ...localFileSystemLive,
            writeText: (path, value, replace) => {
              if (failReleaseMarker && path.includes(".lock/free.")) {
                failReleaseMarker = false;
                return Effect.fail(storageFailure("write", path));
              }
              return localFileSystemLive.writeText(path, value, replace);
            },
          };
          const failingStore = yield* Effect.gen(function* () {
            return yield* DiagramStore;
          }).pipe(Effect.provide(storeLayer(root, failingFilesystem)));
          const baseStore = yield* DiagramStore;

          const created = yield* failingStore.create(builtDiagram());
          const shown = yield* baseStore.show("release-flow");
          const retryError = yield* Effect.flip(
            baseStore.create(builtDiagram()),
          );

          assert.strictEqual(created.manifest.revision, 1);
          assert.strictEqual(shown.manifest.revision, 1);
          assert.strictEqual(shown.document.spec.title, "Release approval");
          assert.deepStrictEqual(shown.revisions, []);
          assert.strictEqual(retryError._tag, "CliStorageError");
          if (retryError._tag === "CliStorageError") {
            assert.strictEqual(retryError.code, "diagram_already_exists");
          }
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect(
    "returns a committed edit once when removing its owner lock fails",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const baseStore = yield* DiagramStore;
          yield* baseStore.create(builtDiagram());
          let failOwnerRelease = true;
          const failingFilesystem: (typeof LocalFileSystem)["Service"] = {
            ...localFileSystemLive,
            removeFile: (path) => {
              if (failOwnerRelease && path.includes(".lock/owner.")) {
                failOwnerRelease = false;
                return Effect.fail(storageFailure("remove-file", path));
              }
              return localFileSystemLive.removeFile(path);
            },
          };
          const failingStore = yield* Effect.gen(function* () {
            return yield* DiagramStore;
          }).pipe(Effect.provide(storeLayer(root, failingFilesystem)));

          const edited = yield* failingStore.edit(
            "release-flow",
            builtDiagram({ title: "Release approval revised" }),
          );
          const shown = yield* baseStore.show("release-flow");
          const editedAgain = yield* baseStore.edit(
            "release-flow",
            builtDiagram({ title: "Release approval final" }),
          );

          assert.strictEqual(edited.manifest.revision, 2);
          assert.strictEqual(shown.manifest.revision, 2);
          assert.strictEqual(
            shown.document.spec.title,
            "Release approval revised",
          );
          assert.deepStrictEqual(shown.revisions, ["000001/"]);
          assert.strictEqual(editedAgain.manifest.revision, 3);
          assert.deepStrictEqual(editedAgain.revisions, ["000001/", "000002/"]);
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect(
    "preserves a pre-commit filesystem failure when lock release also fails",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          let failManifestWrite = true;
          let failOwnerRelease = true;
          const failingFilesystem: (typeof LocalFileSystem)["Service"] = {
            ...localFileSystemLive,
            writeText: (path, value, replace) => {
              if (failManifestWrite && path.endsWith("/manifest.json")) {
                failManifestWrite = false;
                return Effect.fail(storageFailure("write", path));
              }
              return localFileSystemLive.writeText(path, value, replace);
            },
            removeFile: (path) => {
              if (failOwnerRelease && path.includes(".lock/owner.")) {
                failOwnerRelease = false;
                return Effect.fail(storageFailure("remove-file", path));
              }
              return localFileSystemLive.removeFile(path);
            },
          };
          const failingStore = yield* Effect.gen(function* () {
            return yield* DiagramStore;
          }).pipe(Effect.provide(storeLayer(root, failingFilesystem)));
          const baseStore = yield* DiagramStore;

          const error = yield* Effect.flip(failingStore.create(builtDiagram()));
          const created = yield* baseStore.create(builtDiagram());

          assert.strictEqual(error._tag, "CliFilesystemError");
          if (error._tag === "CliFilesystemError") {
            assert.strictEqual(error.operation, "write");
            assert.match(error.path, /manifest\.json$/);
          }
          assert.strictEqual(created.manifest.revision, 1);
          assert.deepStrictEqual(created.revisions, []);
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect("rolls an interrupted edit commit back to the prior record", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const baseStore = yield* DiagramStore;
        yield* baseStore.create(builtDiagram());

        const failingFilesystem: (typeof LocalFileSystem)["Service"] = {
          ...localFileSystemLive,
          rename: (source, destination) =>
            source.includes("/.stage.") &&
            destination === join(root, "release-flow")
              ? Effect.fail(
                  storageFailure("rename", `${source} -> ${destination}`),
                )
              : localFileSystemLive.rename(source, destination),
        };
        const editAttempt = Effect.gen(function* () {
          const store = yield* DiagramStore;
          return yield* Effect.flip(
            store.edit(
              "release-flow",
              builtDiagram({ title: "Must roll back" }),
            ),
          );
        }).pipe(Effect.provide(storeLayer(root, failingFilesystem)));
        const error = yield* editAttempt;
        const unchanged = yield* baseStore.show("release-flow");

        assert.strictEqual(error._tag, "CliFilesystemError");
        assert.strictEqual(unchanged.manifest.revision, 1);
        assert.strictEqual(unchanged.document.spec.title, "Release approval");
        assert.deepStrictEqual(unchanged.revisions, []);
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );

  it.effect(
    "does not remove a replacement lock installed during stale takeover",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const baseStore = yield* DiagramStore;
          yield* baseStore.create(builtDiagram());
          const lockDirectory = join(
            root,
            ".locks",
            `${Buffer.from("release-flow", "utf8").toString("base64url")}.lock`,
          );
          const staleOwner = join(lockDirectory, "owner.stale.json");
          const replacementOwner = join(
            lockDirectory,
            "owner.replacement.json",
          );
          yield* Effect.promise(async () => {
            for (const entry of await readdir(lockDirectory)) {
              await rm(join(lockDirectory, entry), {
                force: true,
                recursive: true,
              });
            }
            await writeFile(
              staleOwner,
              `${JSON.stringify({ pid: 2_147_483_647, token: "stale" })}\n`,
            );
          });

          let replaceDuringCleanup = true;
          const racingFilesystem: (typeof LocalFileSystem)["Service"] = {
            ...localFileSystemLive,
            writeText: (path, value, replace) => {
              const write = localFileSystemLive.writeText(path, value, replace);
              if (
                !replaceDuringCleanup ||
                !path.startsWith(`${lockDirectory}/.owner-candidate.`) ||
                path === staleOwner ||
                path === replacementOwner
              ) {
                return write;
              }
              replaceDuringCleanup = false;
              return write.pipe(
                Effect.andThen(
                  Effect.gen(function* () {
                    yield* localFileSystemLive.removeFile(staleOwner);
                    yield* localFileSystemLive.writeText(
                      replacementOwner,
                      `${JSON.stringify({ pid: process.pid, token: "replacement" })}\n`,
                    );
                  }),
                ),
              );
            },
          };
          const editError = yield* Effect.gen(function* () {
            const store = yield* DiagramStore;
            return yield* Effect.flip(
              store.edit(
                "release-flow",
                builtDiagram({ title: "Must remain locked out" }),
              ),
            );
          }).pipe(Effect.provide(storeLayer(root, racingFilesystem)));

          assert.strictEqual(editError._tag, "CliStorageError");
          if (editError._tag === "CliStorageError") {
            assert.strictEqual(editError.code, "diagram_busy");
          }
          assert.strictEqual(
            yield* localFileSystemLive.kind(replacementOwner),
            "file",
          );
          assert.deepStrictEqual(
            (yield* Effect.promise(() => readdir(lockDirectory))).sort(),
            ["owner.replacement.json"],
          );
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.live(
    "keeps show, list, and export on one coherent revision during edit",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const baseStore = yield* DiagramStore;
          yield* baseStore.create(builtDiagram());
          const enteredGap = yield* Deferred.make<void>();
          const releaseCommit = yield* Deferred.make<void>();
          const readersWaiting = yield* Deferred.make<void>();
          const readerAttempts = yield* Ref.make(0);
          const record = join(root, "release-flow");
          const lockDirectory = join(
            root,
            ".locks",
            `${Buffer.from("release-flow", "utf8").toString("base64url")}.lock`,
          );
          const pausingFilesystem: (typeof LocalFileSystem)["Service"] = {
            ...localFileSystemLive,
            rename: (source, destination) =>
              source === record && destination.includes("/.backup.")
                ? localFileSystemLive.rename(source, destination).pipe(
                    Effect.tap(() => Deferred.succeed(enteredGap, undefined)),
                    Effect.andThen(Deferred.await(releaseCommit)),
                  )
                : localFileSystemLive.rename(source, destination),
          };
          const observingFilesystem: (typeof LocalFileSystem)["Service"] = {
            ...localFileSystemLive,
            list: (path) =>
              localFileSystemLive
                .list(path)
                .pipe(
                  Effect.tap(() =>
                    path === lockDirectory
                      ? Ref.updateAndGet(
                          readerAttempts,
                          (count) => count + 1,
                        ).pipe(
                          Effect.flatMap((count) =>
                            count >= 3
                              ? Deferred.succeed(readersWaiting, undefined)
                              : Effect.void,
                          ),
                        )
                      : Effect.void,
                  ),
                ),
          };
          const writer = yield* Effect.gen(function* () {
            return yield* DiagramStore;
          }).pipe(Effect.provide(storeLayer(root, pausingFilesystem)));
          const reader = yield* Effect.gen(function* () {
            return yield* DiagramStore;
          }).pipe(Effect.provide(storeLayer(root, observingFilesystem)));
          const editFiber = yield* writer
            .edit(
              "release-flow",
              builtDiagram({ title: "Release approval revised" }),
            )
            .pipe(Effect.forkChild);
          yield* Deferred.await(enteredGap);

          const showFiber = yield* reader
            .show("release-flow")
            .pipe(Effect.forkChild);
          const listFiber = yield* reader.list().pipe(Effect.forkChild);
          const exportFiber = yield* reader
            .readExportSource("release-flow", "scene")
            .pipe(Effect.forkChild);
          yield* Deferred.await(readersWaiting);
          assert.strictEqual(
            yield* localFileSystemLive.kind(record),
            "missing",
          );

          yield* Deferred.succeed(releaseCommit, undefined);
          yield* Fiber.join(editFiber);

          const shown = yield* Fiber.join(showFiber);
          const listed = yield* Fiber.join(listFiber);
          const exportSource = yield* Fiber.join(exportFiber);
          assert.strictEqual(exportSource._tag, "StoredArtifact");
          if (exportSource._tag !== "StoredArtifact") return;
          const scene = JSON.parse(
            new TextDecoder().decode(exportSource.bytes),
          );
          assert.strictEqual(shown.manifest.revision, 2);
          assert.strictEqual(
            shown.document.spec.title,
            "Release approval revised",
          );
          assert.deepStrictEqual(
            listed.map(({ id, revision, title }) => ({ id, revision, title })),
            [
              {
                id: "release-flow",
                revision: 2,
                title: "Release approval revised",
              },
            ],
          );
          assert.strictEqual(scene.title, "Release approval revised");
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect("recovers the prior revision after an interrupted edit gap", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const baseStore = yield* DiagramStore;
        yield* baseStore.create(builtDiagram());
        const enteredGap = yield* Deferred.make<void>();
        const record = join(root, "release-flow");
        const pausingFilesystem: (typeof LocalFileSystem)["Service"] = {
          ...localFileSystemLive,
          rename: (source, destination) =>
            source === record && destination.includes("/.backup.")
              ? localFileSystemLive.rename(source, destination).pipe(
                  Effect.tap(() => Deferred.succeed(enteredGap, undefined)),
                  Effect.andThen(Effect.never),
                )
              : localFileSystemLive.rename(source, destination),
        };
        const writer = yield* Effect.gen(function* () {
          return yield* DiagramStore;
        }).pipe(Effect.provide(storeLayer(root, pausingFilesystem)));
        const editFiber = yield* writer
          .edit("release-flow", builtDiagram({ title: "Interrupted revision" }))
          .pipe(Effect.forkChild);
        yield* Deferred.await(enteredGap);
        yield* Fiber.interrupt(editFiber);

        const recovered = yield* baseStore.show("release-flow");
        const entries = yield* Effect.promise(() => readdir(root));
        assert.strictEqual(recovered.manifest.revision, 1);
        assert.strictEqual(recovered.document.spec.title, "Release approval");
        assert.deepStrictEqual(recovered.revisions, []);
        assert.isFalse(entries.some((entry) => entry.startsWith(".backup.")));
        assert.isFalse(entries.some((entry) => entry.startsWith(".stage.")));
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );

  it.effect("rejects symlinked record content instead of following it", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const store = yield* DiagramStore;
        yield* store.create(builtDiagram());
        yield* Effect.promise(() =>
          symlink("document.json", join(root, "release-flow/unsafe-link")),
        );
        const error = yield* Effect.flip(store.show("release-flow"));

        assert.strictEqual(error._tag, "CliStorageError");
        if (error._tag === "CliStorageError") {
          assert.strictEqual(error.code, "unsafe_storage_entry");
        }
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );

  it.effect(
    "rejects a symlinked diagrams root without mutating its target",
    () =>
      withTestRoot((sandbox) => {
        const diagramsRoot = join(sandbox, "diagrams");
        const external = join(sandbox, "external-root-target");
        const sentinel = join(external, "sentinel.txt");
        return Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await mkdir(external);
            await writeFile(sentinel, "untouched\n");
            await symlink(external, diagramsRoot, "dir");
          });

          const store = yield* DiagramStore;
          const error = yield* Effect.flip(store.create(builtDiagram()));

          assert.strictEqual(error._tag, "CliStorageError");
          if (error._tag === "CliStorageError") {
            assert.strictEqual(error.code, "unsafe_storage_entry");
          }
          assert.strictEqual(
            yield* localFileSystemLive.kind(diagramsRoot),
            "symbolic-link",
          );
          assert.deepStrictEqual(
            yield* Effect.promise(() => readdir(external)),
            ["sentinel.txt"],
          );
          assert.strictEqual(
            yield* Effect.promise(() => readFile(sentinel, "utf8")),
            "untouched\n",
          );
        }).pipe(Effect.provide(storeLayer(diagramsRoot)));
      }),
  );

  it.effect("rejects a symlinked locks root without mutating its target", () =>
    withTestRoot((sandbox) => {
      const diagramsRoot = join(sandbox, "diagrams");
      const external = join(sandbox, "external-lock-target");
      const sentinel = join(external, "sentinel.txt");
      return Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await mkdir(diagramsRoot);
          await mkdir(external);
          await writeFile(sentinel, "untouched\n");
          await symlink(external, join(diagramsRoot, ".locks"), "dir");
        });

        const store = yield* DiagramStore;
        const error = yield* Effect.flip(store.create(builtDiagram()));

        assert.strictEqual(error._tag, "CliStorageError");
        if (error._tag === "CliStorageError") {
          assert.strictEqual(error.code, "unsafe_storage_entry");
        }
        assert.strictEqual(
          yield* localFileSystemLive.kind(join(diagramsRoot, ".locks")),
          "symbolic-link",
        );
        assert.deepStrictEqual(yield* Effect.promise(() => readdir(external)), [
          "sentinel.txt",
        ]);
        assert.strictEqual(
          yield* Effect.promise(() => readFile(sentinel, "utf8")),
          "untouched\n",
        );
        assert.deepStrictEqual(
          yield* Effect.promise(() => readdir(diagramsRoot)),
          [".locks"],
        );
      }).pipe(Effect.provide(storeLayer(diagramsRoot)));
    }),
  );

  it.effect(
    "bounds coherent-reader lock retries and preserves diagram_busy",
    () =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const baseStore = yield* DiagramStore;
          yield* baseStore.create(builtDiagram());
          const lockDirectory = join(
            root,
            ".locks",
            `${Buffer.from("release-flow", "utf8").toString("base64url")}.lock`,
          );
          yield* Effect.promise(async () => {
            for (const entry of await readdir(lockDirectory)) {
              await rm(join(lockDirectory, entry), {
                force: true,
                recursive: true,
              });
            }
            await writeFile(
              join(lockDirectory, "owner.hung.json"),
              `${JSON.stringify({ pid: process.pid, token: "hung" })}\n`,
            );
          });

          const firstAttempts = yield* Deferred.make<void>();
          const attempts = yield* Ref.make(0);
          const ownerPath = join(lockDirectory, "owner.hung.json");
          const knownDirectories = new Set([
            join(root, ".."),
            root,
            join(root, ".locks"),
            lockDirectory,
          ]);
          const observingFilesystem: (typeof LocalFileSystem)["Service"] = {
            ...localFileSystemLive,
            kind: (path) =>
              knownDirectories.has(path)
                ? Effect.succeed("directory")
                : localFileSystemLive.kind(path),
            list: (path) =>
              path === lockDirectory
                ? Ref.updateAndGet(attempts, (count) => count + 1).pipe(
                    Effect.flatMap((count) =>
                      count >= 3
                        ? Deferred.succeed(firstAttempts, undefined)
                        : Effect.void,
                    ),
                    Effect.as([{ name: "owner.hung.json", kind: "file" }]),
                  )
                : localFileSystemLive.list(path),
            readText: (path) =>
              path === ownerPath
                ? Effect.succeed(
                    `${JSON.stringify({ pid: process.pid, token: "hung" })}\n`,
                  )
                : localFileSystemLive.readText(path),
          };
          const reader = yield* Effect.gen(function* () {
            return yield* DiagramStore;
          }).pipe(Effect.provide(storeLayer(root, observingFilesystem)));
          const showFiber = yield* Effect.flip(
            reader.show("release-flow"),
          ).pipe(Effect.forkChild);
          const listFiber = yield* Effect.flip(reader.list()).pipe(
            Effect.forkChild,
          );
          const exportFiber = yield* Effect.flip(
            reader.readExportSource("release-flow", "scene"),
          ).pipe(Effect.forkChild);

          yield* Deferred.await(firstAttempts);
          yield* TestClock.adjust("1 second");

          const errors = yield* Effect.all([
            Fiber.join(showFiber),
            Fiber.join(listFiber),
            Fiber.join(exportFiber),
          ]);
          for (const error of errors) {
            assert.strictEqual(error._tag, "CliStorageError");
            if (error._tag === "CliStorageError") {
              assert.strictEqual(error.code, "diagram_busy");
            }
          }
          assert.strictEqual(yield* Ref.get(attempts), 153);
        }).pipe(Effect.provide(storeLayer(root))),
      ),
  );

  it.effect("returns only already-stored PNG bytes", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const store = yield* DiagramStore;
        yield* store.create(builtDiagram({ png: validPng }));
        const source = yield* store.readExportSource("release-flow", "png");
        assert.strictEqual(source._tag, "StoredArtifact");
        if (source._tag === "StoredArtifact") {
          assert.deepStrictEqual(source.bytes, validPng);
        }
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );

  it.effect("returns PNG render inputs from the same locked read", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const store = yield* DiagramStore;
        yield* store.create(builtDiagram());
        const source = yield* store.readExportSource("release-flow", "png");
        assert.strictEqual(source._tag, "RenderPng");
        if (source._tag === "RenderPng") {
          assert.match(new TextDecoder().decode(source.scene), /release-flow/u);
          assert.match(
            new TextDecoder().decode(source.excalidraw),
            /excalidraw/u,
          );
        }
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );

  it.effect(
    "rejects export destinations inside diagram storage, including aliases",
    () =>
      withTestRoot((sandbox) => {
        const diagramsRoot = join(sandbox, "diagrams");
        const record = join(diagramsRoot, "release-flow");
        const alias = join(sandbox, "diagrams-alias");
        const recordAlias = join(sandbox, "record-alias");
        return Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await mkdir(record, { recursive: true });
            await symlink(diagramsRoot, alias, "dir");
            await symlink(record, recordAlias, "dir");
          });
          for (const destination of [
            join(record, "diagram.png"),
            join(alias, "release-flow", "diagram.png"),
            join(recordAlias, "diagram.png"),
          ]) {
            const error = yield* Effect.flip(
              writeExportFile(destination, new Uint8Array([1, 2, 3])),
            );
            assert.strictEqual(error._tag, "CliExportError");
            if (error._tag === "CliExportError") {
              assert.strictEqual(error.code, "invalid_destination");
              assert.match(error.hint, /outside ~\/\.sketchi\/diagrams/u);
            }
          }
          assert.strictEqual(
            yield* localFileSystemLive.kind(join(record, "diagram.png")),
            "missing",
          );
        }).pipe(Effect.provide(exportFileLayer(diagramsRoot)));
      }),
  );

  it.effect.prop(
    "lists arbitrary safe ids in deterministic ascending order",
    {
      ids: FastCheck.uniqueArray(
        FastCheck.tuple(
          FastCheck.constantFrom(..."abcdefghijklmnopqrstuvwxyz"),
          FastCheck.integer({ min: 0, max: 999 }),
        ).map(
          ([prefix, suffix]) => `${prefix}-${String(suffix).padStart(3, "0")}`,
        ),
        { minLength: 1, maxLength: 8 },
      ),
    },
    ({ ids }) =>
      withTestRoot((root) =>
        Effect.gen(function* () {
          const store = yield* DiagramStore;
          for (const id of ids) {
            const document = canonicalDocument({
              ...canonicalDocument(),
              spec: { ...canonicalDocument().spec, id, title: `Diagram ${id}` },
            });
            yield* store.create(builtDiagram({ id, document }));
          }
          const listed = yield* store.list();
          assert.deepStrictEqual(
            listed.map(({ id }) => id),
            [...ids].sort(),
          );
        }).pipe(Effect.provide(storeLayer(root))),
      ),
    { timeout: 20_000, fastCheck: { numRuns: 12 } },
  );

  it.effect("orders uppercase and punctuation by code unit", () =>
    withTestRoot((root) =>
      Effect.gen(function* () {
        const store = yield* DiagramStore;
        const ids = [
          "a_",
          "a.",
          "Z",
          "A-",
          "z",
          "A",
          "0",
          "a-",
          "a",
          "A_",
          "A.",
        ];
        for (const id of ids) {
          const document = canonicalDocument({
            ...canonicalDocument(),
            spec: { ...canonicalDocument().spec, id, title: `Diagram ${id}` },
          });
          yield* store.create(builtDiagram({ id, document }));
        }

        const listed = yield* store.list();
        assert.deepStrictEqual(
          listed.map(({ id }) => id),
          ["0", "A", "A-", "A.", "A_", "Z", "a", "a-", "a.", "a_", "z"],
        );
      }).pipe(Effect.provide(storeLayer(root))),
    ),
  );
});
