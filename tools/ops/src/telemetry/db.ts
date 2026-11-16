// Opens DuckDB on Sketchi's span and Code Mode usage catalogs.
//
//   pnpm db                       production, interactive
//   pnpm db --preview             preview
//   pnpm db -c "FROM generations LIMIT 5"
//
// It needs R2_DATA_READ_TOKEN, a read-only R2 Data Catalog token. When the variable is unset it
// runs DuckDB through `infisical run`, which supplies it from Sketchi's prod environment; the
// token never reaches a file.
import { Effect, FileSystem, Option, Path } from "effect";

import { optionalEnv } from "../outputs";
import { opsError } from "../process";

const INFISICAL_PROJECT_ID = "bb3fe729-e290-4740-84d4-304752f0d719";
export const INIT_SQL = new URL("./duckdb-init.sql", import.meta.url).pathname;

/** The DuckDB invocation for `pnpm db <args>`: direct with a token, through Infisical without. */
export function duckdbCommand(args: readonly string[], hasToken: boolean) {
	const preview = args.includes("--preview");
	const duckdbArgs = ["-init", INIT_SQL, ...args.filter((arg) => arg !== "--preview")];
	const env = { TELEMETRY_ENV: preview ? "preview" : "production" };
	if (hasToken) return { command: "duckdb", args: duckdbArgs, env };
	return {
		command: "infisical",
		args: [
			"run",
			"--projectId",
			INFISICAL_PROJECT_ID,
			"--env",
			"prod",
			"--silent",
			"--",
			"duckdb",
			...duckdbArgs,
		],
		env,
	};
}

/**
 * Replaces this process with DuckDB (or Infisical running it). An interactive shell must own the
 * terminal and its Ctrl-C, which cancels a query; a supervising runtime would instead be
 * interrupted and stop the shell. Effect has no exec, so this is Node's `process.execve`.
 */
export const openDuckdb = Effect.fn("ops.telemetry.db")(function* (args: readonly string[]) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const token = yield* optionalEnv("R2_DATA_READ_TOKEN");
	const { command, args: commandArgs, env } = duckdbCommand(args, Option.isSome(token));
	const searchPath = Option.getOrElse(yield* optionalEnv("PATH"), () => "");
	let executable: string | undefined;
	for (const directory of searchPath.split(":").filter(Boolean)) {
		const candidate = path.join(directory, command);
		if (
			yield* fs.access(candidate, { ok: true }).pipe(
				Effect.as(true),
				Effect.orElseSucceed(() => false),
			)
		) {
			executable = candidate;
			break;
		}
	}
	if (!executable) return yield* opsError(`Could not find ${command} on PATH.`);
	const file = executable;
	if (typeof process.execve !== "function") {
		return yield* opsError("This platform cannot replace the process with DuckDB.");
	}
	return yield* Effect.sync(() =>
		// @effect-diagnostics-next-line processEnv:off -- exec hands DuckDB our whole environment
		process.execve?.(file, [command, ...commandArgs], { ...process.env, ...env }),
	);
});
