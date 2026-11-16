import { CanvasSpec } from "@sketchi/drawing";
import { join } from "node:path";

import { Effect, Result, Schema } from "effect";

import {
	DiagramRecordManifest,
	EXCALIDRAW_FILE,
	PNG_FILE,
	RECORD_SCHEMA_VERSION,
	SCENE_FILE,
	type PatchedDiagramArtifacts,
	type PatchSource,
} from "../contracts";
import { encodeJson } from "../document";
import { formatsFor, recordPath, storageError } from "./entries";
import type { makeLocks } from "./locks";
import type { makeRecordReader } from "./record";
import type { StoreContext } from "./service";
import type { makeTransactions } from "./transaction";

export function makePatch(
	{ fs, root }: StoreContext,
	{ withLock }: ReturnType<typeof makeLocks>,
	{ loadUnlocked }: ReturnType<typeof makeRecordReader>,
	{ transition }: ReturnType<typeof makeTransactions>,
) {
	const patchSourceUnavailable = (diagramId: string) =>
		storageError(
			"patch_source_unavailable",
			`Diagram "${diagramId}" has no current authoritative scene to patch.`,
			"Restore a canonical or patched revision before patching this diagram.",
			diagramId,
		);

	const readPatchSourceUnlocked = Effect.fn("sketchi.cli.storage.readPatchSourceUnlocked")(
		function* (diagramId: string) {
			const current = yield* loadUnlocked(diagramId);
			if (current.authority === "detached" || !current.manifest.formats.includes("scene")) {
				return yield* patchSourceUnavailable(diagramId);
			}
			const scenePath = join(recordPath(root.path, diagramId), SCENE_FILE);
			const text = yield* fs.readText(scenePath);
			const decoded = yield* Effect.sync(() => {
				try {
					return Schema.decodeUnknownResult(CanvasSpec, {
						errors: "all",
						reportInput: true,
					})(JSON.parse(text));
				} catch {
					return undefined;
				}
			});
			if (!decoded || Result.isFailure(decoded) || decoded.success.diagramId !== diagramId) {
				return yield* storageError(
					"corrupt_record",
					`Diagram "${diagramId}" has an invalid current scene artifact.`,
					"Restore a valid prior revision before patching this diagram.",
					diagramId,
				);
			}
			return {
				revision: current.manifest.revision,
				scene: decoded.success,
			} satisfies PatchSource;
		},
	);

	const readPatchSource = Effect.fn("sketchi.cli.storage.readPatchSource")((diagramId: string) =>
		withLock(diagramId, readPatchSourceUnlocked(diagramId), true),
	);

	const commitPatch = Effect.fn("sketchi.cli.storage.commitPatch")(
		(diagramId: string, expectedRevision: number, artifacts: PatchedDiagramArtifacts) =>
			transition(
				diagramId,
				(current) =>
					Effect.gen(function* () {
						if (current.manifest.revision !== expectedRevision) {
							return yield* storageError(
								"patch_conflict",
								`Diagram "${diagramId}" changed before the patch could commit.`,
								"Run sketchi show, verify the current record, and retry the patch if it is still intended.",
								diagramId,
							);
						}
						if (current.authority === "detached" || !current.manifest.formats.includes("scene")) {
							return yield* patchSourceUnavailable(diagramId);
						}
						if (artifacts.scene.diagramId !== diagramId) {
							return yield* storageError(
								"storage_commit_failed",
								`Patched scene id "${artifacts.scene.diagramId}" does not match "${diagramId}".`,
								"Retry the patch against the named stored diagram.",
								diagramId,
							);
						}
						const manifest = DiagramRecordManifest.make({
							schemaVersion: RECORD_SCHEMA_VERSION,
							id: diagramId,
							type: current.manifest.type,
							title: current.manifest.title,
							revision: current.manifest.revision + 1,
							authority: "patched",
							formats: formatsFor("patched", false),
						});
						return manifest;
					}),
				(stage, current, manifest) =>
					Effect.gen(function* () {
						yield* fs.writeText(join(stage, SCENE_FILE), encodeJson(artifacts.scene), true);
						yield* fs.writeText(
							join(stage, EXCALIDRAW_FILE),
							encodeJson(artifacts.excalidraw),
							true,
						);
						yield* fs.remove(join(stage, PNG_FILE));
						return { manifest, document: current.document };
					}),
			),
	);

	return { readPatchSource, commitPatch };
}
