// Machine-wide gate slots. Effect has no cross-process lock, so a slot is an exclusive SQLite
// transaction: SQLite holds it with an fcntl lock that the kernel drops when the gate exits or is
// killed, so a dead gate never holds a slot and no gate ever frees another's.
import { DatabaseSync } from "node:sqlite";

import { Clock, Effect, FileSystem, Option, Path, Schema } from "effect";

import { opsError } from "../process";

const SQLITE_BUSY = 5;

export const SlotHolder = Schema.Struct({
	pid: Schema.Number,
	cwd: Schema.String,
	startedAt: Schema.Number,
});
export type SlotHolder = typeof SlotHolder.Type;

const decodeHolder = Schema.decodeUnknownOption(Schema.fromJsonString(SlotHolder));

function tryLock(file: string) {
	const db = new DatabaseSync(file, { timeout: 0 });
	try {
		db.exec("BEGIN EXCLUSIVE");
		return db;
	} catch (error) {
		db.close();
		if ((error as { errcode?: number }).errcode === SQLITE_BUSY) return undefined;
		throw error;
	}
}

export interface SlotOptions {
	readonly dir: string;
	readonly slots: number;
	readonly pollInterval?: `${number} ${"millis" | "seconds"}`;
	/** Called on each full poll with the current holders. */
	readonly onWait?: (holders: readonly SlotHolder[]) => Effect.Effect<void>;
}

/**
 * Takes one of `slots` slots under `dir`, waiting while all are held, and holds it for the
 * enclosing scope. `slot-<n>.json` names the holder, for the wait notice only.
 */
export const acquireSlot = Effect.fn("ops.ciLocal.acquireSlot")(function* (options: SlotOptions) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	yield* fs.makeDirectory(options.dir, { recursive: true }).pipe(Effect.orDie);
	const owner = { pid: process.pid, cwd: process.cwd() };
	for (;;) {
		const holders: SlotHolder[] = [];
		for (let index = 0; index < options.slots; index += 1) {
			const info = path.join(options.dir, `slot-${index}.json`);
			const db = yield* Effect.try({
				try: () => tryLock(path.join(options.dir, `slot-${index}.db`)),
				catch: (error) => opsError(`Could not open gate slot ${index}: ${String(error)}`),
			});
			if (!db) {
				const holder = yield* fs.readFileString(info).pipe(
					Effect.map((text) => Option.getOrUndefined(decodeHolder(text))),
					Effect.orElseSucceed(() => undefined),
				);
				holders.push(
					holder ?? { pid: 0, cwd: "unknown", startedAt: yield* Clock.currentTimeMillis },
				);
				continue;
			}
			const startedAt = yield* Clock.currentTimeMillis;
			yield* fs.writeFileString(info, JSON.stringify({ ...owner, startedAt })).pipe(Effect.orDie);
			// The holder file goes while the slot is still held, so it never names the next one.
			yield* Effect.addFinalizer(() =>
				fs.remove(info, { force: true }).pipe(
					Effect.ignore,
					Effect.andThen(
						Effect.sync(() => {
							db.exec("ROLLBACK");
							db.close();
						}),
					),
				),
			);
			return index;
		}
		if (options.onWait) yield* options.onWait(holders);
		yield* Effect.sleep(options.pollInterval ?? "5 seconds");
	}
});
