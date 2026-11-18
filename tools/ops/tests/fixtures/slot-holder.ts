// Another gate on the machine: `hold <dir>` takes a slot and keeps it until killed;
// `contend <dir> <active>` takes and releases a slot 200 times and prints the most it saw held.
import { readdirSync, rmSync, writeFileSync } from "node:fs";

import { NodeRuntime } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Effect } from "effect";

import { acquireSlot } from "../../src/ci-local/slots";

const [mode, dir = "", active = ""] = process.argv.slice(2);

const hold = Effect.scoped(
	Effect.gen(function* () {
		yield* acquireSlot({ dir, slots: 1, pollInterval: "5 millis" });
		yield* Console.log("held");
		return yield* Effect.never;
	}),
);

const contend = Effect.gen(function* () {
	let most = 0;
	for (let round = 0; round < 200; round += 1) {
		yield* Effect.scoped(
			Effect.gen(function* () {
				yield* acquireSlot({ dir, slots: 2, pollInterval: "1 millis" });
				const marker = `${active}/${process.pid}`;
				writeFileSync(marker, "");
				most = Math.max(most, readdirSync(active).length);
				yield* Effect.sleep(`${Math.random()} millis`);
				rmSync(marker);
			}),
		);
	}
	yield* Console.log(JSON.stringify(most));
});

NodeRuntime.runMain((mode === "hold" ? hold : contend).pipe(Effect.provide(NodeServices.layer)));
