import { join } from "node:path";

import { Effect } from "effect";

import {
	DiagramRecordManifest,
	EXCALIDRAW_FILE,
	PNG_FILE,
	RECORD_SCHEMA_VERSION,
} from "../contracts.js";
import { formatsFor, storageError } from "./entries.js";
import type { StoreContext } from "./service.js";
import type { makeTransactions } from "./transaction.js";

export function makeReplaceWithDetached(
	{ fs }: StoreContext,
	{ transition }: ReturnType<typeof makeTransactions>,
) {
	const replaceWithDetached = Effect.fn("sketchi.cli.storage.replaceWithDetached")(
		(diagramId: string, excalidraw: Uint8Array, expectedRevision?: number) =>
			transition(
				diagramId,
				(current) =>
					Effect.gen(function* () {
						if (expectedRevision !== undefined && current.manifest.revision !== expectedRevision) {
							return yield* storageError(
								"replacement_conflict",
								`Diagram "${diagramId}" changed before the pulled replacement could commit.`,
								"Run sketchi show, verify the current record, and retry the pull if it is still intended.",
								diagramId,
							);
						}
						const manifest = DiagramRecordManifest.make({
							schemaVersion: RECORD_SCHEMA_VERSION,
							id: diagramId,
							type: current.manifest.type,
							title: current.manifest.title,
							revision: current.manifest.revision + 1,
							authority: "detached",
							formats: formatsFor("detached", false),
						});
						return manifest;
					}),
				(stage, current, manifest) =>
					Effect.gen(function* () {
						yield* fs.writeBytes(join(stage, EXCALIDRAW_FILE), excalidraw, true);
						yield* fs.remove(join(stage, PNG_FILE));
						return { manifest, document: current.document };
					}),
			),
	);

	return replaceWithDetached;
}
