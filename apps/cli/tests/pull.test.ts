import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { exitCodeForFailure } from "../src/errors.js";
import { localFileSystemLive, builtDiagram } from "./fixtures.js";
import { LocalFileSystem } from "../src/filesystem.js";
import { CliPngRenderer, HeadlessPngRenderError } from "../src/render/png-renderer.js";
import { pullIntoStore } from "../src/share/pull.js";
import { ExcalidrawShare } from "../src/share/excalidraw.js";
import { DiagramStore, makeStorageRootLayer } from "../src/store/service.js";
import { DiagramStoreLive } from "../src/store/live.js";

const testParent = resolve(process.cwd(), ".memory/cli-tests");
const rendererProbeScene = builtDiagram().excalidraw;

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
	it.effect("leaves the complete record unchanged when the PNG render probe fails", () =>
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
					assert.deepStrictEqual(yield* Effect.promise(() => snapshotTree(record)), before);
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
											code: "rasterization_failed",
											stage: "rasterization",
											message: "probe failed",
											details: [],
										}),
									),
							}),
						),
					),
				),
			(root) => Effect.promise(() => rm(root, { force: true, recursive: true })),
		),
	);
});
