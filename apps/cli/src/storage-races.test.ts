import { basename, dirname, join, sep } from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { DiagramRecordManifest } from "./contracts.js";
import { LocalFileSystem, type LocalEntry } from "./filesystem.js";
import { DiagramStore, DiagramStoreLive, makeStorageRootLayer } from "./storage.js";
import { builtDiagram } from "./__tests__/fixtures.js";

/** Only synchronous, in-memory operations: race transitions occur at named calls. */
function memoryRecord() {
	const root = join(sep, "sketchi-reader-races", "diagrams");
	const diagram = builtDiagram();
	const record = join(root, diagram.id);
	const encodedId = Buffer.from(diagram.id).toString("base64url");
	const lock = join(root, ".locks", `${encodedId}.lock`);
	const backup = join(root, `.backup.${encodedId}.2147483647.interrupted`);
	type Entry =
		| { readonly kind: "directory" }
		| { readonly kind: "file"; readonly bytes: Uint8Array };
	const entries = new Map<string, Entry>();
	const text = (path: string, value: unknown) =>
		entries.set(path, {
			kind: "file",
			bytes: new TextEncoder().encode(JSON.stringify(value)),
		});
	for (const path of [
		dirname(root),
		root,
		join(root, ".locks"),
		lock,
		record,
		join(record, "revisions"),
	])
		entries.set(path, { kind: "directory" });
	text(join(lock, "free.initial.json"), { token: "initial" });
	text(
		join(record, "manifest.json"),
		DiagramRecordManifest.make({
			schemaVersion: 1,
			id: diagram.id,
			title: diagram.title,
			type: diagram.type,
			revision: 2,
			authority: "canonical",
			formats: ["scene", "excalidraw"],
		}),
	);
	text(join(record, "document.json"), diagram.document);
	text(join(record, "scene.json"), diagram.scene);
	text(join(record, "diagram.excalidraw"), diagram.excalidraw);
	text(join(record, "revisions", "000001.json"), diagram.document);

	const inTree = (path: string, parent: string) => path === parent || path.startsWith(parent + sep);
	const move = (source: string, destination: string) => {
		assert.isTrue(entries.has(source), `missing mock rename source ${source}`);
		for (const [path, entry] of [...entries]) {
			if (!inTree(path, source)) continue;
			entries.delete(path);
			entries.set(destination + path.slice(source.length), entry);
		}
	};
	const hasReaderLock = () =>
		[...entries.keys()].some(
			(path) =>
				dirname(path) === lock &&
				basename(path).startsWith("owner.") &&
				basename(path) !== "owner.writer.json",
		);
	const readBytes = (path: string) =>
		Effect.sync(() => {
			const entry = entries.get(path);
			if (entry?.kind !== "file") throw new Error(`missing mock file ${path}`);
			return entry.bytes;
		});
	const fs: (typeof LocalFileSystem)["Service"] = {
		kind: (path) => Effect.sync(() => entries.get(path)?.kind ?? "missing"),
		list: (path) =>
			Effect.sync(() =>
				[...entries].flatMap(([child, entry]): LocalEntry[] =>
					dirname(child) === path ? [{ name: basename(child), kind: entry.kind }] : [],
				),
			),
		readBytes,
		readText: (path) =>
			readBytes(path).pipe(Effect.map((bytes) => new TextDecoder().decode(bytes))),
		writeText: (path, value) =>
			Effect.sync(() => {
				entries.set(path, {
					kind: "file",
					bytes: new TextEncoder().encode(value),
				});
			}),
		writeBytes: (path, bytes) =>
			Effect.sync(() => {
				entries.set(path, { kind: "file", bytes });
			}),
		tryWriteText: (path, value) =>
			Effect.sync(() => {
				if (entries.has(path)) return false;
				entries.set(path, {
					kind: "file",
					bytes: new TextEncoder().encode(value),
				});
				return true;
			}),
		tryLinkFile: (source, destination) =>
			Effect.sync(() => {
				const entry = entries.get(source);
				if (entry?.kind !== "file" || entries.has(destination)) return false;
				entries.set(destination, entry);
				return true;
			}),
		makeDirectory: (path) =>
			Effect.sync(() => {
				entries.set(path, { kind: "directory" });
			}),
		makeTempDirectory: () => Effect.die("unexpected mock temporary directory"),
		tryRenameDirectory: () => Effect.die("unexpected mock directory installation"),
		rename: (source, destination) => Effect.sync(() => move(source, destination)),
		removeFile: (path) => Effect.sync(() => entries.delete(path)),
		remove: (path) =>
			Effect.sync(() => {
				for (const child of [...entries.keys()]) if (inTree(child, path)) entries.delete(child);
			}),
		realPath: (path) => Effect.succeed(path),
	};
	return {
		root,
		record,
		lock,
		backup,
		fs,
		hasReaderLock,
		startWriter: (pid: number) => {
			move(record, backup);
			for (const path of [...entries.keys()]) if (dirname(path) === lock) entries.delete(path);
			text(join(lock, "owner.writer.json"), { pid, token: "writer" });
		},
		finishWriter: () => {
			move(backup, record);
			entries.delete(join(lock, "owner.writer.json"));
			text(join(lock, "free.finished.json"), { token: "finished" });
		},
	};
}

function readerLayer(root: string, fs: (typeof LocalFileSystem)["Service"]) {
	return DiagramStoreLive.pipe(
		Layer.provide(Layer.mergeAll(makeStorageRootLayer(root), Layer.succeed(LocalFileSystem, fs))),
	);
}

describe("reader/writer transaction races", () => {
	for (const command of ["show", "export", "revision", "patch-source"] satisfies ReadonlyArray<
		"show" | "export" | "revision" | "patch-source"
	>) {
		it.effect(
			`${command} reads a writer that completes between missing-record observation and root scan`,
			() => {
				const memory = memoryRecord();
				memory.startWriter(process.pid);
				let sawGap = false;
				let writerFinished = false;
				const fs: (typeof LocalFileSystem)["Service"] = {
					...memory.fs,
					kind: (path) =>
						memory.fs.kind(path).pipe(
							Effect.tap((kind) =>
								Effect.sync(() => {
									if (path === memory.record && kind === "missing") sawGap = true;
								}),
							),
						),
					list: (path) =>
						Effect.suspend(() => {
							if (path === memory.root && sawGap && !writerFinished) {
								memory.finishWriter();
								writerFinished = true;
							}
							return memory.fs.list(path);
						}),
					readText: (path) =>
						Effect.suspend(() => {
							if (path === join(memory.record, "manifest.json"))
								assert.isTrue(memory.hasReaderLock());
							return memory.fs.readText(path);
						}),
				};
				return Effect.gen(function* () {
					const store = yield* DiagramStore;
					const revision = yield* command === "show"
						? store.show("release-flow").pipe(Effect.map((diagram) => diagram.manifest.revision))
						: command === "export"
							? store.readExportSource("release-flow", "scene").pipe(
									Effect.map((source) => {
										assert.strictEqual(source._tag, "StoredArtifact");
										if (source._tag === "StoredArtifact")
											assert.deepStrictEqual(
												source.bytes,
												new TextEncoder().encode(JSON.stringify(builtDiagram().scene)),
											);
										return 1;
									}),
								)
							: command === "revision"
								? store
										.readRevision("release-flow", 1)
										.pipe(Effect.map((source) => source.revision))
								: store
										.readPatchSource("release-flow")
										.pipe(Effect.map((source) => source.revision));
					assert.strictEqual(revision, command === "show" || command === "patch-source" ? 2 : 1);
					assert.isTrue(sawGap);
					assert.isTrue(writerFinished);
				}).pipe(Effect.provide(readerLayer(memory.root, fs)));
			},
		);
	}

	it.effect(
		"list recovers a backup created after discovery but before acquiring the record lock",
		() => {
			const memory = memoryRecord();
			let discovered = false;
			let writerCrashed = false;
			let lockedRecoveryScans = 0;
			const fs: (typeof LocalFileSystem)["Service"] = {
				...memory.fs,
				list: (path) =>
					memory.fs.list(path).pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								if (path !== memory.root) return;
								if (discovered) {
									assert.isTrue(memory.hasReaderLock());
									lockedRecoveryScans += 1;
								}
								discovered = true;
							}),
						),
					),
				kind: (path) =>
					Effect.suspend(() => {
						if (path === memory.lock && discovered && !writerCrashed) {
							memory.startWriter(2_147_483_647);
							writerCrashed = true;
						}
						return memory.fs.kind(path);
					}),
				rename: (source, destination) =>
					Effect.suspend(() => {
						assert.strictEqual(source, memory.backup);
						assert.strictEqual(destination, memory.record);
						assert.isTrue(memory.hasReaderLock());
						return memory.fs.rename(source, destination);
					}),
			};
			return Effect.gen(function* () {
				const store = yield* DiagramStore;
				const entries = yield* store.list();
				assert.isTrue(writerCrashed);
				assert.strictEqual(entries.length, 1);
				assert.strictEqual(entries[0]?.id, "release-flow");
				assert.strictEqual(entries[0]?.revision, 2);
				assert.isFalse("status" in entries[0]!);
				assert.strictEqual(lockedRecoveryScans, 1);
				assert.strictEqual(yield* memory.fs.kind(memory.backup), "missing");
				assert.strictEqual(yield* memory.fs.kind(memory.record), "directory");
			}).pipe(Effect.provide(readerLayer(memory.root, fs)));
		},
	);
});
