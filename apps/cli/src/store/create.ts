// @effect-diagnostics-next-line nodeBuiltinImport:off -- These synchronous host-native path calculations feed the scoped CLI filesystem operations.
import { join } from "node:path";

import { Clock, Effect } from "effect";

import {
	DiagramRecordManifest,
	MANIFEST_FILE,
	RECORD_SCHEMA_VERSION,
	type BuiltDiagram,
	type StoredDiagram,
} from "../contracts";
import { encodeJson } from "../document";
import { STAGE_PREFIX, formatsFor, recordPath, storageError } from "./entries";
import type { makeLocks } from "./locks";
import type { StoreContext } from "./service";
import type { makeTransactions } from "./transaction";

export function makeCreate(
	{ fs, root }: StoreContext,
	{ withLock }: ReturnType<typeof makeLocks>,
	{ writeBuilt }: ReturnType<typeof makeTransactions>,
) {
	const create = Effect.fn("sketchi.cli.storage.create")(function* (diagram: BuiltDiagram) {
		return yield* withLock(
			diagram.id,
			Effect.gen(function* () {
				const destination = recordPath(root.path, diagram.id);
				if ((yield* fs.kind(destination)) !== "missing") {
					return yield* storageError(
						"diagram_already_exists",
						`Diagram "${diagram.id}" already exists.`,
						"Use sketchi edit for full-document replacement.",
						diagram.id,
					);
				}
				// @effect-diagnostics-next-line globalDateInEffect:off -- Preserve ISO formatting of the timestamp already read from Effect Clock.
				const createdAt = new Date(yield* Clock.currentTimeMillis).toISOString();
				const manifest = DiagramRecordManifest.make({
					schemaVersion: RECORD_SCHEMA_VERSION,
					id: diagram.id,
					type: diagram.type,
					title: diagram.title,
					revision: 1,
					authority: "canonical",
					formats: formatsFor("canonical", diagram.png !== undefined),
					createdAt,
					...(diagram.prompt === undefined ? {} : { prompt: diagram.prompt }),
				});
				return yield* Effect.acquireUseRelease(
					fs.makeTempDirectory(root.path, STAGE_PREFIX),
					(stage) =>
						Effect.gen(function* () {
							yield* writeBuilt(stage, diagram);
							yield* fs.writeText(join(stage, MANIFEST_FILE), encodeJson(manifest), true);
							yield* fs.rename(stage, destination);
							return {
								manifest,
								...(diagram.warnings?.length ? { warnings: diagram.warnings } : {}),
								document: diagram.document,
								revisions: [],
								authority: "canonical",
							} satisfies StoredDiagram;
						}),
					(stage) => fs.remove(stage),
				);
			}),
		);
	});

	return create;
}
