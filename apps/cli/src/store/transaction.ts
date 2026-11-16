import { join } from "node:path";

import { Effect } from "effect";

import {
	DOCUMENT_FILE,
	DiagramRecordManifest,
	EXCALIDRAW_FILE,
	MANIFEST_FILE,
	PNG_FILE,
	REVISIONS_DIRECTORY,
	SCENE_FILE,
	type BuiltDiagram,
	type StoredDiagram,
	recordProvenance,
	revisionDirectoryName,
} from "../contracts.js";
import { type DiagramDocument, encodeJson } from "../document.js";
import type { CliFilesystemError, CliStorageError } from "../errors.js";
import { isValidPng } from "../render/png-validate.js";
import {
	BACKUP_PREFIX,
	STAGE_PREFIX,
	compareRevisionEntries,
	encodedId,
	recordPath,
	storageError,
	unsafeEntry,
} from "./entries.js";
import type { makeLocks } from "./locks.js";
import type { makeRecordReader } from "./record.js";
import type { StoreContext } from "./service.js";

/** Staged, atomic record replacement that archives the current state as a revision. */
export function makeTransactions(
	{ fs, root }: StoreContext,
	{ withLock }: ReturnType<typeof makeLocks>,
	{ loadUnlocked }: ReturnType<typeof makeRecordReader>,
) {
	const copySafeTree: (
		source: string,
		destination: string,
		diagramId: string,
	) => Effect.Effect<void, CliFilesystemError | CliStorageError> = Effect.fn(
		"sketchi.cli.storage.copySafeTree",
	)(function* (source: string, destination: string, diagramId: string) {
		const entries = yield* fs.list(source);
		for (const entry of entries) {
			const sourcePath = join(source, entry.name);
			const destinationPath = join(destination, entry.name);
			if (entry.kind === "directory") {
				yield* fs.makeDirectory(destinationPath);
				yield* copySafeTree(sourcePath, destinationPath, diagramId);
			} else if (entry.kind === "file") {
				const bytes = yield* fs.readBytes(sourcePath);
				yield* fs.writeBytes(destinationPath, bytes);
			} else {
				return yield* unsafeEntry(sourcePath, diagramId);
			}
		}
	});

	const copyRecordSnapshot = Effect.fn("sketchi.cli.storage.copyRecordSnapshot")(function* (
		source: string,
		destination: string,
		diagramId: string,
	) {
		yield* fs.makeDirectory(destination);
		for (const entry of yield* fs.list(source)) {
			if (entry.name === REVISIONS_DIRECTORY) continue;
			const sourcePath = join(source, entry.name);
			const destinationPath = join(destination, entry.name);
			if (entry.kind === "file") {
				yield* fs.writeBytes(destinationPath, yield* fs.readBytes(sourcePath));
			} else {
				return yield* unsafeEntry(sourcePath, diagramId);
			}
		}
	});

	const commitStage = Effect.fn("sketchi.cli.storage.commitStage")(function* (
		diagramId: string,
		stage: string,
	) {
		const source = recordPath(root.path, diagramId);
		const backup = join(
			root.path,
			`${BACKUP_PREFIX}${encodedId(diagramId)}.${String(process.pid)}.${crypto.randomUUID()}`,
		);
		yield* fs.rename(source, backup);
		const committed = yield* fs.rename(stage, source).pipe(
			Effect.matchEffect({
				onFailure: (commitError) =>
					fs.rename(backup, source).pipe(
						Effect.matchEffect({
							onFailure: () =>
								Effect.fail(
									storageError(
										"storage_commit_failed",
										`Atomic storage commit and rollback both failed for "${diagramId}".`,
										"Retry; Sketchi will recover the backup transaction before the next operation.",
										diagramId,
									),
								),
							onSuccess: () => Effect.fail(commitError),
						}),
					),
				onSuccess: () => Effect.succeed(true),
			}),
		);
		if (committed) {
			yield* fs.remove(backup).pipe(Effect.catch(() => Effect.void));
		}
	});

	const snapshotCurrent = Effect.fn("sketchi.cli.storage.snapshotCurrent")(function* (
		diagramId: string,
		stage: string,
		currentRevision: number,
	) {
		const destination = join(stage, REVISIONS_DIRECTORY, revisionDirectoryName(currentRevision));
		if ((yield* fs.kind(destination)) !== "missing") {
			return yield* storageError(
				"corrupt_record",
				`Diagram "${diagramId}" already has a snapshot for current revision ${String(currentRevision)}.`,
				"Inspect the revisions directory before retrying.",
				diagramId,
			);
		}
		yield* copyRecordSnapshot(recordPath(root.path, diagramId), destination, diagramId);
	});

	const writeBuilt = Effect.fn("sketchi.cli.storage.writeBuilt")(function* (
		stage: string,
		diagram: BuiltDiagram,
	) {
		if (diagram.png && !isValidPng(diagram.png)) {
			return yield* storageError(
				"corrupt_record",
				`Diagram "${diagram.id}" has an invalid stored PNG artifact.`,
				"Recover a valid prior revision or rebuild the record.",
				diagram.id,
			);
		}
		yield* fs.makeDirectory(join(stage, REVISIONS_DIRECTORY), true);
		yield* fs.writeText(join(stage, DOCUMENT_FILE), encodeJson(diagram.document), true);
		yield* fs.writeText(join(stage, SCENE_FILE), encodeJson(diagram.scene), true);
		yield* fs.writeText(join(stage, EXCALIDRAW_FILE), encodeJson(diagram.excalidraw), true);
		const pngPath = join(stage, PNG_FILE);
		yield* fs.remove(pngPath);
		if (diagram.png) yield* fs.writeBytes(pngPath, diagram.png);
	});

	const transition = Effect.fn("sketchi.cli.storage.transition")(function* <Prepared>(
		diagramId: string,
		prepare: (
			current: StoredDiagram,
		) => Effect.Effect<Prepared, CliFilesystemError | CliStorageError>,
		write: (
			stage: string,
			current: StoredDiagram,
			prepared: Prepared,
		) => Effect.Effect<
			{
				readonly manifest: DiagramRecordManifest;
				readonly document: DiagramDocument;
			},
			CliFilesystemError | CliStorageError
		>,
	) {
		return yield* withLock(
			diagramId,
			Effect.gen(function* () {
				const current = yield* loadUnlocked(diagramId);
				const prepared = yield* prepare(current);
				return yield* Effect.acquireUseRelease(
					fs.makeTempDirectory(root.path, STAGE_PREFIX),
					(stage) =>
						Effect.gen(function* () {
							yield* copySafeTree(recordPath(root.path, diagramId), stage, diagramId);
							yield* snapshotCurrent(diagramId, stage, current.manifest.revision);
							const written = yield* write(stage, current, prepared);
							const next = {
								...written,
								manifest: DiagramRecordManifest.make({
									...written.manifest,
									...recordProvenance(current.manifest),
								}),
							};
							yield* fs.writeText(join(stage, MANIFEST_FILE), encodeJson(next.manifest), true);
							yield* commitStage(diagramId, stage);
							return {
								...next,
								revisions: [
									...current.revisions,
									`${revisionDirectoryName(current.manifest.revision)}/`,
								].sort(compareRevisionEntries),
								authority: next.manifest.authority,
							} satisfies StoredDiagram;
						}),
					(stage) => fs.remove(stage),
				);
			}),
		);
	});

	return { copySafeTree, writeBuilt, transition };
}
