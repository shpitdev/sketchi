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
const ACCOUNT_ID = "75f9660f39e4dafe8b95980b87e7399a";
export const INIT_SQL = decodeURIComponent(new URL("./duckdb-init.sql", import.meta.url).pathname);
export const VIEWS_SQL = decodeURIComponent(
	new URL("./duckdb-views.sql", import.meta.url).pathname,
);

/**
 * Attaches the selected span catalog. DuckDB takes an ATTACH path only as a literal, so it runs
 * between the init file, which creates the secret, and the views that read `telemetry`.
 */
function attachSpans(environment: "preview" | "production") {
	const bucket = `sketchi-telemetry-${environment}`;
	return `ATTACH '${ACCOUNT_ID}_${bucket}' AS telemetry (TYPE ICEBERG, ENDPOINT 'https://catalog.cloudflarestorage.com/${ACCOUNT_ID}/${bucket}', SECRET r2_data_read, READ_ONLY)`;
}

/** The DuckDB invocation for `pnpm db <args>`: direct with a token, through Infisical without. */
export function duckdbCommand(args: readonly string[], hasToken: boolean) {
	const environment = args.includes("--preview") ? "preview" : "production";
	const duckdbArgs = [
		"-init",
		INIT_SQL,
		"-cmd",
		attachSpans(environment),
		"-cmd",
		// The DuckDB shell splits a dot command's arguments at spaces outside double quotes.
		`.read "${VIEWS_SQL}"`,
		...args.filter((arg) => arg !== "--preview"),
	];
	const env = { TELEMETRY_ENV: environment };
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
