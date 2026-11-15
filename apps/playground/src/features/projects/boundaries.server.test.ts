import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
	makeStudioObjectStoreLayer,
	StudioObjectStore,
	type StudioObjectBucket,
	type StudioObjectBucketBody,
	type StudioObjectBucketListOptions,
} from "./bucket.server.js";
class FailingBucket implements StudioObjectBucket {
	constructor(private readonly operation: "delete" | "get" | "head" | "list" | "put") {}

	async head() {
		if (this.operation === "head") throw new Error("R2 head failed");
		return null;
	}
	async delete(): Promise<unknown> {
		if (this.operation === "delete") {
			throw new Error("R2 delete failed");
		}
		return null;
	}

	async get() {
		if (this.operation === "get") {
			throw new Error("R2 get failed");
		}
		return null;
	}

	async list(options: StudioObjectBucketListOptions) {
		if (this.operation === "list") {
			throw new Error("R2 list failed");
		}
		return { objects: [], prefix: options.prefix, truncated: false };
	}

	async put(_key: string, _value: StudioObjectBucketBody) {
		if (this.operation === "put") {
			throw new Error("R2 put failed");
		}
		return { uploaded: new Date(0), etag: "test" };
	}
}

describe("StudioObjectStore R2 boundary", () => {
	const operations: ReadonlyArray<"delete" | "get" | "head" | "list" | "put"> = [
		"get",
		"head",
		"put",
		"list",
		"delete",
	];

	for (const operation of operations) {
		it.layer(makeStudioObjectStoreLayer(new FailingBucket(operation)))(
			`${operation} failure`,
			(it) => {
				it.effect(`wraps R2 ${operation} failures once with their cause`, () =>
					Effect.gen(function* () {
						const objectStore = yield* StudioObjectStore;
						const effect =
							operation === "head"
								? objectStore.head("studio/test.json")
								: operation === "get"
									? objectStore.getText("studio/test.json")
									: operation === "put"
										? objectStore.put("studio/test.json", "{}")
										: operation === "list"
											? objectStore.list({ prefix: "studio/" })
											: objectStore.delete("studio/test.json");
						const error = yield* Effect.flip(effect);

						assert.strictEqual(error._tag, "StudioStorageError");
						assert.strictEqual(error.operation, operation);
						assert.instanceOf(error.cause, Error);
						assert.strictEqual(error.message, `R2 ${operation} failed`);
					}),
				);
			},
		);
	}
});
