import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { exitCodeForFailure } from "./errors.js";
import { LocalFileSystem, localFileSystemLive } from "./filesystem.js";
import { CliPngRenderer, HeadlessPngRenderError } from "./png-renderer.js";
import { pullIntoStore } from "./pull.js";
import { ExcalidrawShare } from "./share.js";
import {
  DiagramStore,
  DiagramStoreLive,
  makeStorageRootLayer,
} from "./storage.js";
import { builtDiagram } from "./__tests__/fixtures.js";

const testParent = resolve(process.cwd(), ".memory/cli-tests");
const rendererProbeScene = builtDiagram().excalidraw;

function oversizedScene() {
  return {
    type: "excalidraw",
    version: 2,
    source: "fixture",
    elements: [
      {
        id: "oversized",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 6000,
        height: 6000,
        angle: 0,
      },
    ],
    appState: {},
    files: {},
  };
}

async function snapshotTree(root: string): Promise<ReadonlyArray<unknown>> {
  const entries: Array<unknown> = [];
  const visit = async (directory: string, prefix = ""): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
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

describe("pull transaction", () => {
  it.effect(
    "rejects an oversized render probe with exit 3 and unchanged storage",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(async () => {
          await mkdir(testParent, { recursive: true });
          return mkdtemp(join(testParent, "pull-"));
        }),
        (root) =>
          Effect.gen(function* () {
            const store = yield* DiagramStore;
            yield* store.create(builtDiagram());
            const record = join(root, "release-flow");
            const before = yield* Effect.promise(() =>
              Promise.all(
                [
                  "manifest.json",
                  "document.json",
                  "scene.json",
                  "diagram.excalidraw",
                ].map(
                  async (file) =>
                    [file, await readFile(join(record, file))] as const,
                ),
              ),
            );

            const failure = yield* Effect.flip(
              pullIntoStore(
                "release-flow",
                "https://excalidraw.com/#json=test,AAAAAAAAAAAAAAAAAAAAAA",
              ),
            );
            assert.strictEqual(exitCodeForFailure(failure), 3);
            assert.strictEqual(failure._tag, "CliShareError");
            if (failure._tag === "CliShareError") {
              assert.strictEqual(failure.code, "unsupported_scene");
            }
            for (const [file, bytes] of before) {
              assert.deepStrictEqual(
                yield* Effect.promise(() => readFile(join(record, file))),
                bytes,
              );
            }
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                Layer.fresh(DiagramStoreLive).pipe(
                  Layer.provide(
                    Layer.mergeAll(
                      Layer.succeed(LocalFileSystem, localFileSystemLive),
                      makeStorageRootLayer(root),
                    ),
                  ),
                ),
                Layer.succeed(ExcalidrawShare, {
                  share: () => Effect.die("unused share"),
                  pull: () => Effect.succeed(oversizedScene()),
                }),
                Layer.succeed(CliPngRenderer, {
                  normalizeExcalidraw: () =>
                    Effect.fail(
                      HeadlessPngRenderError.make({
                        cause: new Error("renderer must not be reached"),
                        message: "renderer must not be reached",
                      }),
                    ),
                  renderPng: () =>
                    Effect.fail(
                      HeadlessPngRenderError.make({
                        cause: new Error("renderer must not be reached"),
                        message: "renderer must not be reached",
                      }),
                    ),
                }),
              ),
            ),
          ),
        (root) =>
          Effect.promise(() => rm(root, { force: true, recursive: true })),
      ),
  );

  it.effect(
    "leaves the complete record unchanged when the PNG render probe fails",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(async () => {
          await mkdir(testParent, { recursive: true });
          return mkdtemp(join(testParent, "pull-"));
        }),
        (root) =>
          Effect.gen(function* () {
            const store = yield* DiagramStore;
            yield* store.create(builtDiagram());
            const record = join(root, "release-flow");
            const before = yield* Effect.promise(() => snapshotTree(record));
            const failure = yield* Effect.flip(
              pullIntoStore(
                "release-flow",
                "https://excalidraw.com/#json=test,AAAAAAAAAAAAAAAAAAAAAA",
              ),
            );

            assert.strictEqual(exitCodeForFailure(failure), 3);
            assert.strictEqual(failure._tag, "CliShareError");
            if (failure._tag === "CliShareError") {
              assert.strictEqual(failure.code, "unsupported_scene");
            }
            assert.deepStrictEqual(
              yield* Effect.promise(() => snapshotTree(record)),
              before,
            );
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                Layer.fresh(DiagramStoreLive).pipe(
                  Layer.provide(
                    Layer.mergeAll(
                      Layer.succeed(LocalFileSystem, localFileSystemLive),
                      makeStorageRootLayer(root),
                    ),
                  ),
                ),
                Layer.succeed(ExcalidrawShare, {
                  share: () => Effect.die("unused share"),
                  pull: () => Effect.succeed(rendererProbeScene),
                }),
                Layer.succeed(CliPngRenderer, {
                  normalizeExcalidraw: () => Effect.succeed(rendererProbeScene),
                  renderPng: () =>
                    Effect.fail(
                      HeadlessPngRenderError.make({
                        cause: new Error("probe failed"),
                        message: "probe failed",
                      }),
                    ),
                }),
              ),
            ),
          ),
        (root) =>
          Effect.promise(() => rm(root, { force: true, recursive: true })),
      ),
  );
});
