import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";

import { CliFilesystemError } from "../src/errors.js";
import { LocalFileSystem } from "../src/filesystem.js";
import {
	DiagramStore,
	DiagramStoreLive,
	makeStorageRootLayer,
	writeExportFile,
} from "../src/storage.js";
import { builtDiagram, localFileSystemLive } from "./fixtures.js";

const testParent = resolve(process.cwd(), ".memory/cli-tests");
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
			Layer.mergeAll(Layer.succeed(LocalFileSystem, filesystem), makeStorageRootLayer(root)),
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
	it.effect("atomically creates the complete versioned record layout", () =>
		withTestRoot((root) =>
			Effect.gen(function* () {
				const store = yield* DiagramStore;
				const created = yield* store.create(builtDiagram());

				assert.strictEqual(created.manifest.schemaVersion, 1);
				assert.strictEqual(created.manifest.revision, 1);
				assert.deepStrictEqual(created.manifest.formats, ["scene", "excalidraw"]);
				assert.deepStrictEqual(
					(yield* Effect.promise(() => readdir(join(root, "release-flow")))).sort(),
					["diagram.excalidraw", "document.json", "manifest.json", "revisions", "scene.json"],
				);
				assert.deepStrictEqual(
					yield* Effect.promise(() => readdir(join(root, "release-flow", "revisions"))),
					[],
				);
			}).pipe(Effect.provide(storeLayer(root))),
		),
	);

	it.effect("preserves each prior canonical document as a recoverable revision", () =>
		withTestRoot((root) =>
			Effect.gen(function* () {
				const store = yield* DiagramStore;
				yield* store.create(builtDiagram());
				yield* store.edit("release-flow", builtDiagram({ title: "Release approval revised" }));
				const edited = yield* store.show("release-flow");
				const revision = JSON.parse(
					yield* Effect.promise(() =>
						readFile(join(root, "release-flow/revisions/000001/document.json"), "utf8"),
					),
				);

				assert.strictEqual(edited.manifest.revision, 2);
				assert.strictEqual(edited.document.spec.title, "Release approval revised");
				assert.deepStrictEqual(edited.revisions, ["000001/"]);
				assert.strictEqual(revision.spec.title, "Release approval");
			}).pipe(Effect.provide(storeLayer(root))),
		),
	);

	it.effect("rejects a pulled replacement when the observed revision changed", () =>
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
						source.includes("/.stage.") && destination === join(root, "release-flow")
							? Effect.fail(storageFailure("rename", `${source} -> ${destination}`))
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
				const source = yield* baseStore.readExportSource("release-flow", "excalidraw");
				assert.strictEqual(source._tag, "StoredArtifact");
				if (source._tag === "StoredArtifact") {
					assert.deepStrictEqual(source.bytes, replacement);
				}
				assert.strictEqual(
					yield* localFileSystemLive.kind(join(root, "release-flow/revisions/000002")),
					"missing",
				);
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

	it.effect("recovers an unpublished partial owner left by process termination", () =>
		withTestRoot((root) =>
			Effect.gen(function* () {
				const store = yield* DiagramStore;
				yield* store.create(builtDiagram());
				const lockDirectory = join(
					root,
					".locks",
					`${Buffer.from("release-flow", "utf8").toString("base64url")}.lock`,
				);
				const candidatePath = join(lockDirectory, ".owner-candidate.interrupted.json");
				yield* Effect.promise(() => writeFile(candidatePath, "{"));

				const shown = yield* store.show("release-flow");

				assert.strictEqual(shown.manifest.revision, 1);
				assert.strictEqual(yield* localFileSystemLive.kind(candidatePath), "missing");
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
						source.includes("/.stage.") && destination === join(root, "release-flow")
							? Effect.fail(storageFailure("rename", `${source} -> ${destination}`))
							: localFileSystemLive.rename(source, destination),
				};
				const editAttempt = Effect.gen(function* () {
					const store = yield* DiagramStore;
					return yield* Effect.flip(
						store.edit("release-flow", builtDiagram({ title: "Must roll back" })),
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

	it.effect("does not remove a replacement lock installed during stale takeover", () =>
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
				const replacementOwner = join(lockDirectory, "owner.replacement.json");
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
						store.edit("release-flow", builtDiagram({ title: "Must remain locked out" })),
					);
				}).pipe(Effect.provide(storeLayer(root, racingFilesystem)));

				assert.strictEqual(editError._tag, "CliStorageError");
				if (editError._tag === "CliStorageError") {
					assert.strictEqual(editError.code, "diagram_busy");
				}
				assert.strictEqual(yield* localFileSystemLive.kind(replacementOwner), "file");
				assert.deepStrictEqual((yield* Effect.promise(() => readdir(lockDirectory))).sort(), [
					"owner.replacement.json",
				]);
			}).pipe(Effect.provide(storeLayer(root))),
		),
	);

	it.live("keeps show, list, and export on one coherent revision during edit", () =>
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
										? Ref.updateAndGet(readerAttempts, (count) => count + 1).pipe(
												Effect.flatMap((count) =>
													count >= 3 ? Deferred.succeed(readersWaiting, undefined) : Effect.void,
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
					.edit("release-flow", builtDiagram({ title: "Release approval revised" }))
					.pipe(Effect.forkChild);
				yield* Deferred.await(enteredGap);

				const showFiber = yield* reader.show("release-flow").pipe(Effect.forkChild);
				const listFiber = yield* reader.list().pipe(Effect.forkChild);
				const exportFiber = yield* reader
					.readExportSource("release-flow", "scene")
					.pipe(Effect.forkChild);
				yield* Deferred.await(readersWaiting);
				assert.strictEqual(yield* localFileSystemLive.kind(record), "missing");

				yield* Deferred.succeed(releaseCommit, undefined);
				yield* Fiber.join(editFiber);

				const shown = yield* Fiber.join(showFiber);
				const listed = yield* Fiber.join(listFiber);
				const exportSource = yield* Fiber.join(exportFiber);
				assert.strictEqual(exportSource._tag, "StoredArtifact");
				if (exportSource._tag !== "StoredArtifact") return;
				const scene = JSON.parse(new TextDecoder().decode(exportSource.bytes));
				assert.strictEqual(shown.manifest.revision, 2);
				assert.strictEqual(shown.document.spec.title, "Release approval revised");
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

	it.effect("rejects a symlinked diagrams root without mutating its target", () =>
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
				assert.strictEqual(yield* localFileSystemLive.kind(diagramsRoot), "symbolic-link");
				assert.deepStrictEqual(yield* Effect.promise(() => readdir(external)), ["sentinel.txt"]);
				assert.strictEqual(yield* Effect.promise(() => readFile(sentinel, "utf8")), "untouched\n");
			}).pipe(Effect.provide(storeLayer(diagramsRoot)));
		}),
	);

	it.effect("bounds coherent-reader lock retries and preserves diagram_busy", () =>
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
										count >= 3 ? Deferred.succeed(firstAttempts, undefined) : Effect.void,
									),
									Effect.as([{ name: "owner.hung.json", kind: "file" }]),
								)
							: localFileSystemLive.list(path),
					readText: (path) =>
						path === ownerPath
							? Effect.succeed(`${JSON.stringify({ pid: process.pid, token: "hung" })}\n`)
							: localFileSystemLive.readText(path),
				};
				const reader = yield* Effect.gen(function* () {
					return yield* DiagramStore;
				}).pipe(Effect.provide(storeLayer(root, observingFilesystem)));
				const showFiber = yield* Effect.flip(reader.show("release-flow")).pipe(Effect.forkChild);
				const listFiber = yield* reader.list().pipe(Effect.forkChild);
				const exportFiber = yield* Effect.flip(
					reader.readExportSource("release-flow", "scene"),
				).pipe(Effect.forkChild);

				yield* Deferred.await(firstAttempts);
				yield* TestClock.adjust("1 second");

				const errors = yield* Effect.all([Fiber.join(showFiber), Fiber.join(exportFiber)]);
				for (const error of errors) {
					assert.strictEqual(error._tag, "CliStorageError");
					if (error._tag === "CliStorageError") {
						assert.strictEqual(error.code, "diagram_busy");
					}
				}
				const entries = yield* Fiber.join(listFiber);
				assert.strictEqual(entries.length, 1);
				assert.isTrue("status" in entries[0]!);
				if ("status" in entries[0]!) assert.strictEqual(entries[0].code, "diagram_busy");
				assert.strictEqual(yield* Ref.get(attempts), 153);
			}).pipe(Effect.provide(storeLayer(root))),
		),
	);

	it.effect("rejects export destinations inside diagram storage, including aliases", () =>
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
					join(diagramsRoot, "..diagram.png"),
					join(record, "diagram.png"),
					join(alias, "release-flow", "diagram.png"),
					join(recordAlias, "diagram.png"),
				]) {
					const error = yield* Effect.flip(writeExportFile(destination, new Uint8Array([1, 2, 3])));
					assert.strictEqual(error._tag, "CliExportError");
					if (error._tag === "CliExportError") {
						assert.strictEqual(error.code, "invalid_destination");
						assert.match(error.hint, /outside ~\/\.sketchi\/diagrams/u);
					}
				}
				assert.strictEqual(yield* localFileSystemLive.kind(join(record, "diagram.png")), "missing");
			}).pipe(Effect.provide(exportFileLayer(diagramsRoot)));
		}),
	);
});
