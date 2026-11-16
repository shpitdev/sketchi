import { join } from "node:path";

import { Effect, Result } from "effect";

import { MANIFEST_FILE, type DiagramListEntry, summaryFromStored } from "../contracts.js";
import {
	BACKUP_PREFIX,
	compareCodeUnits,
	decodedId,
	isVisibleRecord,
	recordPath,
} from "./entries.js";
import type { makeLocks } from "./locks.js";
import type { makeRecordReader } from "./record.js";
import type { makeRecovery } from "./recovery.js";
import type { StoreContext } from "./service.js";

export function makeList(
	{ fs, root }: StoreContext,
	{ ensureRoot, recoverStages }: ReturnType<typeof makeRecovery>,
	{ withLock }: ReturnType<typeof makeLocks>,
	{ loadUnlocked }: ReturnType<typeof makeRecordReader>,
) {
	const discoverIds = Effect.fn("sketchi.cli.storage.discoverIds")(function* () {
		yield* ensureRoot();
		const entries = yield* fs.list(root.path);
		yield* recoverStages(entries);
		const diagramIds = new Set<string>();
		for (const entry of entries) {
			if (isVisibleRecord(entry)) {
				diagramIds.add(entry.name);
				continue;
			}
			if (!entry.name.startsWith(BACKUP_PREFIX)) continue;
			const id = decodedId(entry.name.split(".")[2] ?? "");
			if (id) diagramIds.add(id);
		}
		return [...diagramIds].sort(compareCodeUnits);
	});

	// Resolving an id is a read: a store that was never created holds no ids.
	const ids = Effect.fn("sketchi.cli.storage.ids")(function* () {
		if ((yield* fs.kind(root.path)) === "missing") return [];
		return yield* discoverIds();
	});

	const updatedAt = (diagramId: string) =>
		fs.modifiedAt(join(recordPath(root.path, diagramId), MANIFEST_FILE)).pipe(
			Effect.map((time) => (time === undefined ? {} : { updatedAt: new Date(time).toISOString() })),
			// The time only orders the listing; a vanished or unreadable manifest has none.
			Effect.catch(() => Effect.succeed({})),
		);

	const list = Effect.fn("sketchi.cli.storage.list")(function* () {
		return yield* Effect.forEach(
			yield* discoverIds(),
			(diagramId) =>
				withLock(
					diagramId,
					loadUnlocked(diagramId).pipe(
						Effect.flatMap((stored) =>
							updatedAt(diagramId).pipe(
								Effect.map((time) => ({ ...summaryFromStored(stored), ...time })),
							),
						),
					),
					true,
					true,
				).pipe(
					Effect.result,
					Effect.map((result): DiagramListEntry => {
						if (Result.isSuccess(result)) return result.success;
						const error = result.failure;
						return {
							id: diagramId,
							status: "unavailable",
							code: error._tag === "CliStorageError" ? error.code : "filesystem_error",
							message: error.message,
							hint:
								error._tag === "CliStorageError"
									? error.hint
									: "Check local paths and permissions, then retry.",
						};
					}),
				),
			{ concurrency: 4 },
		);
	});

	return { ids, list };
}
