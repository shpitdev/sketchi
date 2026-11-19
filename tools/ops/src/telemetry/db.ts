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

import { optionalEnv, requiredEnv } from "../outputs";
import { opsError } from "../process";

export const INIT_SQL = decodeURIComponent(new URL("./duckdb-init.sql", import.meta.url).pathname);
export const VIEWS_SQL = decodeURIComponent(
	new URL("./duckdb-views.sql", import.meta.url).pathname,
);

/**
 * Attaches the selected span catalog. DuckDB takes an ATTACH path only as a literal, so it runs
 * between the init file, which creates the secret, and the views that read `telemetry`.
 */
function attach(accountId: string, bucket: string, alias: string) {
	const id = accountId.replaceAll("'", "''");
	return `ATTACH '${id}_${bucket}' AS ${alias} (TYPE ICEBERG, ENDPOINT 'https://catalog.cloudflarestorage.com/${id}/${bucket}', SECRET r2_data_read, READ_ONLY)`;
}

/** The DuckDB invocation after the catalog credentials are available. */
export function duckdbCommand(args: readonly string[], accountId: string) {
	const environment = args.includes("--preview") ? "preview" : "production";
	const duckdbArgs = [
		"-init",
		INIT_SQL,
		"-cmd",
		attach(accountId, `sketchi-telemetry-${environment}`, "telemetry"),
		"-cmd",
		attach(accountId, "sketchi-codemode-usage-analytics-production-v4", "codemode_history"),
		"-cmd",
		// The DuckDB shell splits a dot command's arguments at spaces outside double quotes.
		`.read "${VIEWS_SQL}"`,
		...args.filter((arg) => arg !== "--preview"),
	];
	return { command: "duckdb", args: duckdbArgs, env: { TELEMETRY_ENV: environment } };
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
	// Re-enter after injection so both the account and the read token may come from Infisical.
	const injected = yield* optionalEnv("SKETCHI_DB_INFISICAL");
	if (Option.isSome(injected) && Option.isNone(token)) {
		return yield* opsError("R2_DATA_READ_TOKEN is required.");
	}
	const {
		command,
		args: commandArgs,
		env,
	} = Option.isSome(token)
		? duckdbCommand(args, yield* requiredEnv("CLOUDFLARE_ACCOUNT_ID"))
		: {
				command: "infisical",
				args: [
					"run",
					"--projectId",
					yield* requiredEnv("INFISICAL_PROJECT_ID"),
					"--env",
					"prod",
					"--silent",
					"--",
					"pnpm",
					"db",
					...args,
				],
				env: { SKETCHI_DB_INFISICAL: "1" },
			};
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
