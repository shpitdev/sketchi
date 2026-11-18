import { CanvasSpec } from "@sketchi/drawing";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- These synchronous host-native path calculations feed the scoped CLI filesystem operations.
import { join } from "node:path";

import { ExcalidrawFile } from "@sketchi/drawing/excalidraw";

import { Effect, Result, Schema } from "effect";

import {
	DOCUMENT_FILE,
	DiagramRecordManifest,
	EXCALIDRAW_FILE,
	MANIFEST_FILE,
	PNG_FILE,
	RECORD_SCHEMA_VERSION,
	REVISIONS_DIRECTORY,
	SCENE_FILE,
	type BuiltDiagram,
	revisionFileName,
	revisionDirectoryName,
} from "../contracts";
import { decodeCanonicalDiagramDocument, encodeJson } from "../document";
import { isValidPng } from "../render/png-validate";
import { validateShareScene } from "../share/protocol";
import { formatsFor, recordPath, storageError, unsafeEntry } from "./entries";
import type { makeLocks } from "./locks";
import type { makeRecordReader } from "./record";
import type { RestoreResult, RevisionSource, StoreContext } from "./service";
import type { makeTransactions } from "./transaction";

export function makeRevisions(
	{ fs, root }: StoreContext,
	{ withLock }: ReturnType<typeof makeLocks>,
	{
		assertSafeTree,
		decodeDocument,
		decodeManifest,
		loadUnlocked,
	}: ReturnType<typeof makeRecordReader>,
	{ copySafeTree, transition, writeBuilt }: ReturnType<typeof makeTransactions>,
) {
	const revisionNotFound = (diagramId: string, revision: number) =>
		storageError(
			"revision_not_found",
			`Diagram "${diagramId}" has no revision ${String(revision)}.`,
			"Run sketchi show to inspect the available revision paths.",
			diagramId,
		);

	const corruptRevision = (diagramId: string, revision: number) =>
		storageError(
			"corrupt_revision",
			`Diagram "${diagramId}" revision ${String(revision)} is corrupt.`,
			"Choose another revision or repair the corrupt snapshot.",
			diagramId,
		);

	const readArchivedJson = Effect.fn("sketchi.cli.storage.validateArchivedJson")(function* (
		path: string,
		diagramId: string,
		revision: number,
	) {
		const text = yield* fs.readText(path);
		return yield* Effect.try({
			try: () => {
				// @effect-diagnostics-next-line globalJsonInEffect:off -- The immutable revision reader maps malformed stored JSON to the existing revision failure.
				const value: unknown = JSON.parse(text);
				if (typeof value !== "object" || value === null) {
					throw new Error("archived JSON must contain an object");
				}
				return value;
			},
			catch: () => corruptRevision(diagramId, revision),
		});
	});

	const validateArchivedArtifact = Effect.fn("sketchi.cli.storage.validateArchivedArtifact")(
		function* (
			path: string,
			kind: "scene" | "excalidraw",
			authority: "canonical" | "patched" | "detached",
			diagramId: string,
			revision: number,
		) {
			const value = yield* readArchivedJson(path, diagramId, revision);
			const valid =
				kind === "scene"
					? Result.isSuccess(
							Schema.decodeUnknownResult(CanvasSpec, {
								errors: "all",
								reportInput: true,
							})(value),
						)
					: Result.isSuccess(
							Schema.decodeUnknownResult(ExcalidrawFile, {
								errors: "all",
								reportInput: true,
							})(value),
						);
			if (!valid) return yield* corruptRevision(diagramId, revision);
			if (kind === "excalidraw" && authority === "detached") {
				yield* validateShareScene(value).pipe(
					Effect.mapError(() => corruptRevision(diagramId, revision)),
				);
			}
		},
	);

	const validateArchivedPng = Effect.fn("sketchi.cli.storage.validateArchivedPng")(function* (
		path: string,
		diagramId: string,
		revision: number,
	) {
		const bytes = yield* fs.readBytes(path);
		if (!isValidPng(bytes)) {
			return yield* corruptRevision(diagramId, revision);
		}
	});

	const readRevisionUnlocked = Effect.fn("sketchi.cli.storage.readRevisionUnlocked")(function* (
		diagramId: string,
		revision: number,
	) {
		const revisions = join(recordPath(root.path, diagramId), REVISIONS_DIRECTORY);
		const snapshot = join(revisions, revisionDirectoryName(revision));
		const snapshotKind = yield* fs.kind(snapshot);
		if (snapshotKind === "directory") {
			yield* assertSafeTree(snapshot, diagramId);
			const manifest = yield* decodeManifest(join(snapshot, MANIFEST_FILE), diagramId).pipe(
				Effect.mapError(() => corruptRevision(diagramId, revision)),
			);
			const document = yield* decodeDocument(join(snapshot, DOCUMENT_FILE), diagramId).pipe(
				Effect.mapError(() => corruptRevision(diagramId, revision)),
			);
			if (
				manifest.id !== diagramId ||
				manifest.revision !== revision ||
				manifest.type !== document.type ||
				manifest.title !== document.spec.title
			) {
				return yield* storageError(
					"corrupt_revision",
					`Diagram "${diagramId}" revision ${String(revision)} has inconsistent metadata.`,
					"Choose another revision or repair the corrupt snapshot.",
					diagramId,
				);
			}
			for (const [required, kind] of [
				[SCENE_FILE, "scene"],
				[EXCALIDRAW_FILE, "excalidraw"],
			] as const) {
				const artifactPath = join(snapshot, required);
				if ((yield* fs.kind(artifactPath)) !== "file") {
					return yield* storageError(
						"corrupt_revision",
						`Diagram "${diagramId}" revision ${String(revision)} is missing ${required}.`,
						"Choose another revision or repair the corrupt snapshot.",
						diagramId,
					);
				}
				yield* validateArchivedArtifact(
					artifactPath,
					kind,
					manifest.authority,
					diagramId,
					revision,
				).pipe(
					Effect.mapError((error) =>
						error._tag === "CliFilesystemError" ? corruptRevision(diagramId, revision) : error,
					),
				);
			}
			const pngKind = yield* fs.kind(join(snapshot, PNG_FILE));
			if (pngKind !== "file" && pngKind !== "missing") {
				return yield* unsafeEntry(join(snapshot, PNG_FILE), diagramId);
			}
			if (pngKind === "file") {
				yield* validateArchivedPng(join(snapshot, PNG_FILE), diagramId, revision).pipe(
					Effect.mapError((error) =>
						error._tag === "CliFilesystemError" ? corruptRevision(diagramId, revision) : error,
					),
				);
			}
			const formats = formatsFor(manifest.authority, pngKind === "file");
			if (
				manifest.formats.length !== formats.length ||
				manifest.formats.some((format, index) => format !== formats[index])
			) {
				return yield* storageError(
					"corrupt_revision",
					`Diagram "${diagramId}" revision ${String(revision)} has inconsistent formats.`,
					"Choose another revision or repair the corrupt snapshot.",
					diagramId,
				);
			}
			return { _tag: "FullSnapshot", revision } satisfies RevisionSource;
		}
		if (snapshotKind !== "missing") {
			return yield* unsafeEntry(snapshot, diagramId);
		}
		const legacy = join(revisions, revisionFileName(revision));
		const legacyKind = yield* fs.kind(legacy);
		if (legacyKind === "missing") {
			return yield* revisionNotFound(diagramId, revision);
		}
		if (legacyKind !== "file") return yield* unsafeEntry(legacy, diagramId);
		const document = yield* decodeCanonicalDiagramDocument(
			yield* readArchivedJson(legacy, diagramId, revision),
		).pipe(
			Effect.mapError(() =>
				storageError(
					"corrupt_revision",
					`Diagram "${diagramId}" revision ${String(revision)} is corrupt.`,
					"Choose another revision or repair the legacy revision file.",
					diagramId,
				),
			),
		);
		return {
			_tag: "LegacyDocument",
			revision,
			document,
		} satisfies RevisionSource;
	});

	const readRevision = Effect.fn("sketchi.cli.storage.readRevision")(
		(diagramId: string, revision: number) =>
			withLock(
				diagramId,
				loadUnlocked(diagramId).pipe(Effect.andThen(readRevisionUnlocked(diagramId, revision))),
				true,
			),
	);

	const restore = Effect.fn("sketchi.cli.storage.restore")(function* (
		diagramId: string,
		revision: number,
		legacyDiagram?: BuiltDiagram,
	) {
		const diagram = yield* transition(
			diagramId,
			(current) =>
				Effect.gen(function* () {
					const selected = yield* readRevisionUnlocked(diagramId, revision);
					if (selected._tag === "LegacyDocument") {
						if (current.authority !== "canonical" || !legacyDiagram) {
							return yield* storageError(
								"restore_conflict",
								`Legacy revision ${String(revision)} requires a canonical rebuild for "${diagramId}".`,
								"Restore a full canonical snapshot, or provide the rebuilt legacy document.",
								diagramId,
							);
						}
						if (
							legacyDiagram.id !== diagramId ||
							encodeJson(legacyDiagram.document) !== encodeJson(selected.document)
						) {
							return yield* storageError(
								"storage_commit_failed",
								`Legacy revision ${String(revision)} rebuild does not match its archived document.`,
								"Rebuild the exact archived canonical document before restoring.",
								diagramId,
							);
						}
					}
					return selected;
				}),
			(stage, current, selected) =>
				Effect.gen(function* () {
					if (selected._tag === "FullSnapshot") {
						const selectedPath = join(stage, REVISIONS_DIRECTORY, revisionDirectoryName(revision));
						for (const entry of yield* fs.list(stage)) {
							if (entry.name !== REVISIONS_DIRECTORY) yield* fs.remove(join(stage, entry.name));
						}
						yield* copySafeTree(selectedPath, stage, diagramId);
						const archived = yield* decodeManifest(join(stage, MANIFEST_FILE), diagramId);
						const document = yield* decodeDocument(join(stage, DOCUMENT_FILE), diagramId);
						const manifest = DiagramRecordManifest.make({
							...archived,
							revision: current.manifest.revision + 1,
						});
						return { manifest, document };
					}
					if (!legacyDiagram) {
						return yield* storageError(
							"storage_commit_failed",
							`Legacy revision ${String(revision)} has no rebuilt document.`,
							"Rebuild the archived canonical document before restoring.",
							diagramId,
						);
					}
					const manifest = DiagramRecordManifest.make({
						schemaVersion: RECORD_SCHEMA_VERSION,
						id: diagramId,
						type: legacyDiagram.type,
						title: legacyDiagram.title,
						revision: current.manifest.revision + 1,
						authority: "canonical",
						formats: formatsFor("canonical", legacyDiagram.png !== undefined),
					});
					yield* writeBuilt(stage, legacyDiagram);
					return { manifest, document: legacyDiagram.document };
				}),
		);
		return {
			diagram,
			restoredFromRevision: revision,
		} satisfies RestoreResult;
	});

	return { readRevision, restore };
}
