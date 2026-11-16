import { Effect, Layer } from "effect";

import { LocalFileSystem } from "../filesystem.js";
import { makeCreate } from "./create.js";
import { makeReplaceWithDetached } from "./detached.js";
import { makeEdit } from "./edit.js";
import { makeList } from "./list.js";
import { makeLocks } from "./locks.js";
import { makePatch } from "./patch.js";
import { makeRead } from "./read.js";
import { makeRecordReader } from "./record.js";
import { makeRecovery } from "./recovery.js";
import { makeRevisions } from "./revisions.js";
import { DiagramStore, StorageRoot } from "./service.js";
import { makeTransactions } from "./transaction.js";

export const DiagramStoreLive = Layer.effect(
	DiagramStore,
	Effect.gen(function* () {
		const store = { fs: yield* LocalFileSystem, root: yield* StorageRoot };
		const recovery = makeRecovery(store);
		const locks = makeLocks(store, recovery);
		const records = makeRecordReader(store);
		const transactions = makeTransactions(store, locks, records);
		const { readPatchSource, commitPatch } = makePatch(store, locks, records, transactions);
		const { readRevision, restore } = makeRevisions(store, locks, records, transactions);
		const { show, readExportSource } = makeRead(store, locks, records);
		const { ids, list } = makeList(store, recovery, locks, records);
		return {
			create: makeCreate(store, locks, transactions),
			edit: makeEdit(transactions),
			readPatchSource,
			commitPatch,
			replaceWithDetached: makeReplaceWithDetached(store, transactions),
			readRevision,
			restore,
			show,
			list,
			ids,
			readExportSource,
		};
	}),
);
