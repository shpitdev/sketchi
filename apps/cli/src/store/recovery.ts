// @effect-diagnostics-next-line nodeBuiltinImport:off -- The recovery boundary derives native paths for leases left by earlier processes.
import { dirname, join } from "node:path";

import { Effect } from "effect";

import {
	BACKUP_PREFIX,
	LOCKS_DIRECTORY,
	compareCodeUnits,
	encodedId,
	filesystemErrorHasCode,
	recordPath,
	unsafeEntry,
} from "./entries";
import type { LocalEntry } from "../filesystem";
import type { StoreContext } from "./service";

export function processIsAlive(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try {
		// A persisted lease may name a process this runtime did not spawn.
		process.kill(pid, 0);
		return true;
	} catch (cause) {
		return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EPERM";
	}
}

function transactionPid(name: string): number | undefined {
	const parts = name.split(".");
	const candidate = Number(parts.at(-2));
	return Number.isSafeInteger(candidate) ? candidate : undefined;
}

/** Creates the storage root and clears transactions a dead process left behind. */
export function makeRecovery({ fs, root }: StoreContext) {
	const ensureOwnedDirectory = Effect.fn("sketchi.cli.storage.ensureOwnedDirectory")(function* (
		path: string,
	) {
		let kind = yield* fs.kind(path);
		if (kind === "missing") {
			yield* fs
				.makeDirectory(path)
				.pipe(
					Effect.catch((error) =>
						filesystemErrorHasCode(error, "EEXIST") ? Effect.void : Effect.fail(error),
					),
				);
			kind = yield* fs.kind(path);
		}
		if (kind !== "directory") return yield* unsafeEntry(path);
	});

	const ensureRoot = Effect.fn("sketchi.cli.storage.ensureRoot")(function* () {
		yield* ensureOwnedDirectory(dirname(root.path));
		yield* ensureOwnedDirectory(root.path);
		yield* ensureOwnedDirectory(join(root.path, LOCKS_DIRECTORY));
	});

	const recoverStages = Effect.fn("sketchi.cli.storage.recoverStages")(function* (
		rootEntries?: ReadonlyArray<LocalEntry>,
	) {
		const entries = [...(rootEntries ?? (yield* fs.list(root.path)))].sort((left, right) =>
			compareCodeUnits(left.name, right.name),
		);
		for (const entry of entries) {
			if (!entry.name.startsWith(".stage.")) continue;
			const pid = transactionPid(entry.name);
			if (pid === undefined || !processIsAlive(pid)) {
				yield* fs.remove(join(root.path, entry.name));
			}
		}
	});

	const recoverRecordTransactions = Effect.fn("sketchi.cli.storage.recoverRecordTransactions")(
		function* (diagramId: string) {
			const backupPrefix = `${BACKUP_PREFIX}${encodedId(diagramId)}.`;
			// Transaction entries can change after discovery; inspect them under lock.
			const entries = [...(yield* fs.list(root.path))]
				.filter((entry) => entry.name.startsWith(backupPrefix))
				.sort((left, right) => compareCodeUnits(left.name, right.name));
			for (const entry of entries) {
				const path = join(root.path, entry.name);
				const current = recordPath(root.path, diagramId);
				const currentKind = yield* fs.kind(current);
				if (currentKind === "missing") yield* fs.rename(path, current);
				else yield* fs.remove(path);
			}
		},
	);

	return { ensureRoot, recoverStages, recoverRecordTransactions };
}
