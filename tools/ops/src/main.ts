// Sketchi operator commands: `pnpm ops <command>`, `pnpm ci:local`, `pnpm db`, `pnpm sanity`.
import { NodeRuntime } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Effect, Layer } from "effect";
import { CliError, Command } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import { ops } from "./commands";

const setExitCode = (code: number) =>
	Effect.sync(() => {
		process.exitCode = code;
	});

const main = Command.run(ops, { version: "0.0.0" }).pipe(
	Effect.catch((error) => {
		// effect/cli has already presented a usage problem.
		if (CliError.isCliError(error)) return setExitCode(2);
		switch (error._tag) {
			// Already reported with its log tail and summary.
			case "GateFailed":
				return setExitCode(1);
			case "ExitCode":
				return setExitCode(error.code);
			default:
				return Console.error(`ops: ${error.message}`).pipe(Effect.andThen(setExitCode(1)));
		}
	}),
	// @effect-diagnostics-next-line strictEffectProvide:off -- the entrypoint
	Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
);

NodeRuntime.runMain(main, { disableErrorReporting: true });
