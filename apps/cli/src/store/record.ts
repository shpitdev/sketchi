import { join } from "node:path";

import { Effect, Schema } from "effect";

import {
	DOCUMENT_FILE,
	DiagramRecordManifest,
	EXCALIDRAW_FILE,
	MANIFEST_FILE,
	PNG_FILE,
	RECORD_SCHEMA_VERSION,
	REVISIONS_DIRECTORY,
	SCENE_FILE,
	type StoredDiagram,
} from "../contracts";
import { decodeStoredDiagramDocument } from "../document";
import type { CliFilesystemError, CliStorageError } from "../errors";
import { hasPngStructure } from "../render/png-validate";
import {
	compareRevisionEntries,
	formatsFor,
	recordPath,
	storageError,
	unsafeEntry,
} from "./entries";
import type { StoreContext } from "./service";

/** Reads and validates one record directory; callers hold its lock. */
export function makeRecordReader({ fs, root }: StoreContext) {
	const assertSafeTree: (
		path: string,
		diagramId?: string,
	) => Effect.Effect<void, CliFilesystemError | CliStorageError> = Effect.fn(
		"sketchi.cli.storage.assertSafeTree",
	)(function* (path: string, diagramId?: string) {
		const entries = yield* fs.list(path);
		for (const entry of entries) {
			const child = join(path, entry.name);
			if (entry.kind === "symbolic-link" || entry.kind === "other") {
				return yield* unsafeEntry(child, diagramId);
			}
			if (entry.kind === "directory") {
				yield* assertSafeTree(child, diagramId);
			}
		}
	});

	const decodeManifest = Effect.fn("sketchi.cli.storage.decodeManifest")(function* (
		path: string,
		diagramId: string,
	) {
		const text = yield* fs.readText(path);
		const parsed: unknown = yield* Effect.try({
			try: () => JSON.parse(text),
			catch: () =>
				storageError(
					"corrupt_record",
					`Diagram "${diagramId}" has an invalid manifest.`,
					"Inspect manifest.json and restore it from a known-good backup.",
					diagramId,
				),
		});
		return yield* Schema.decodeUnknownEffect(DiagramRecordManifest)(parsed).pipe(
			Effect.mapError(() =>
				storageError(
					"corrupt_record",
					`Diagram "${diagramId}" has an incompatible manifest.`,
					`Expected manifest schema version ${String(RECORD_SCHEMA_VERSION)}.`,
					diagramId,
				),
			),
		);
	});

	const decodeDocument = Effect.fn("sketchi.cli.storage.decodeDocument")(function* (
		path: string,
		diagramId: string,
	) {
		const text = yield* fs.readText(path);
		const parsed: unknown = yield* Effect.try({
			try: () => JSON.parse(text),
			catch: () =>
				storageError(
					"corrupt_record",
					`Diagram "${diagramId}" has invalid document JSON.`,
					"Recover a prior canonical document from the revisions directory.",
					diagramId,
				),
		});
		return yield* decodeStoredDiagramDocument(parsed).pipe(
			Effect.mapError(() =>
				storageError(
					"corrupt_record",
					`Diagram "${diagramId}" has an invalid canonical document.`,
					"Regenerate diagrams stored in an older flowchart format; otherwise recover a prior canonical document from the revisions directory.",
					diagramId,
				),
			),
		);
	});

	const loadUnlocked = Effect.fn("sketchi.cli.storage.loadUnlocked")(function* (diagramId: string) {
		const path = recordPath(root.path, diagramId);
		const kind = yield* fs.kind(path);
		if (kind === "missing") {
			return yield* storageError(
				"diagram_not_found",
				`Diagram "${diagramId}" does not exist.`,
				"Run sketchi list to discover stored diagram ids.",
				diagramId,
			);
		}
		if (kind !== "directory") return yield* unsafeEntry(path, diagramId);
		yield* assertSafeTree(path, diagramId);
		const manifest = yield* decodeManifest(join(path, MANIFEST_FILE), diagramId);
		if (manifest.id !== diagramId) {
			return yield* storageError(
				"corrupt_record",
				`Diagram directory "${diagramId}" contains manifest id "${manifest.id}".`,
				"Make the directory name and manifest id agree before retrying.",
				diagramId,
			);
		}
		const document = yield* decodeDocument(join(path, DOCUMENT_FILE), diagramId);
		if (manifest.type !== document.type || manifest.title !== document.spec.title) {
			return yield* storageError(
				"corrupt_record",
				`Diagram "${diagramId}" manifest does not match its canonical document.`,
				"Recover the canonical document and rebuild the record with sketchi edit.",
				diagramId,
			);
		}
		for (const requiredFile of [SCENE_FILE, EXCALIDRAW_FILE]) {
			if ((yield* fs.kind(join(path, requiredFile))) !== "file") {
				return yield* storageError(
					"corrupt_record",
					`Diagram "${diagramId}" is missing required artifact ${requiredFile}.`,
					"Recover the canonical document and rebuild the record with sketchi edit.",
					diagramId,
				);
			}
		}
		const pngKind = yield* fs.kind(join(path, PNG_FILE));
		if (pngKind !== "file" && pngKind !== "missing") {
			return yield* unsafeEntry(join(path, PNG_FILE), diagramId);
		}
		if (pngKind === "file" && !hasPngStructure(yield* fs.readBytes(join(path, PNG_FILE)))) {
			return yield* storageError(
				"corrupt_record",
				`Diagram "${diagramId}" has an invalid stored PNG artifact.`,
				"Recover a valid prior revision or rebuild the record.",
				diagramId,
			);
		}
		const expectedFormats = formatsFor(manifest.authority, pngKind === "file");
		if (
			manifest.formats.length !== expectedFormats.length ||
			manifest.formats.some((format, index) => format !== expectedFormats[index])
		) {
			return yield* storageError(
				"corrupt_record",
				`Diagram "${diagramId}" manifest formats do not match stored artifacts.`,
				"Recover the canonical document and rebuild the record with sketchi edit.",
				diagramId,
			);
		}
		const revisionDirectory = join(path, REVISIONS_DIRECTORY);
		const revisions: string[] = [];
		for (const entry of yield* fs.list(revisionDirectory)) {
			if (entry.kind === "file" && /^\d{6,}\.json$/u.test(entry.name)) {
				revisions.push(entry.name);
				continue;
			}
			if (entry.kind === "directory" && /^\d{6,}$/u.test(entry.name)) {
				revisions.push(`${entry.name}/`);
				continue;
			}
			return yield* unsafeEntry(join(revisionDirectory, entry.name), diagramId);
		}
		revisions.sort(compareRevisionEntries);
		return {
			manifest,
			document,
			revisions,
			authority: manifest.authority,
		} satisfies StoredDiagram;
	});

	return { assertSafeTree, decodeManifest, decodeDocument, loadUnlocked };
}
