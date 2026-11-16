import { Effect, Layer } from "effect";

import { LocalFileSystem } from "../filesystem";
import { makeCreate } from "./create";
import { makeReplaceWithDetached } from "./detached";
import { makeEdit } from "./edit";
import { makeList } from "./list";
import { makeLocks } from "./locks";
import { makePatch } from "./patch";
import { makeRead } from "./read";
import { makeRecordReader } from "./record";
import { makeRecovery } from "./recovery";
import { makeRevisions } from "./revisions";
import { DiagramStore, StorageRoot } from "./service";
import { makeTransactions } from "./transaction";

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
