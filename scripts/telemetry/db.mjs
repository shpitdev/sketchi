// Opens DuckDB on Sketchi's span and Code Mode usage catalogs.
//
//   pnpm db                       production, interactive
//   pnpm db --preview             preview
//   pnpm db -c "FROM generations LIMIT 5"
//
// It needs R2_DATA_READ_TOKEN, a read-only R2 Data Catalog token. When the variable
// is unset it runs DuckDB through `infisical run`, which supplies it from Sketchi's
// prod environment; the token never reaches a file.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const INFISICAL_PROJECT_ID = "bb3fe729-e290-4740-84d4-304752f0d719";
const INIT_SQL = fileURLToPath(new URL("./duckdb-init.sql", import.meta.url));

export function duckdbCommand(args, env) {
	const preview = args.includes("--preview");
	const duckdbArgs = ["-init", INIT_SQL, ...args.filter((arg) => arg !== "--preview")];
	const childEnv = { ...env, TELEMETRY_ENV: preview ? "preview" : "production" };
	if (env.R2_DATA_READ_TOKEN) return { args: duckdbArgs, command: "duckdb", env: childEnv };
	return {
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
		command: "infisical",
		env: childEnv,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const { args, command, env } = duckdbCommand(process.argv.slice(2), process.env);
	const child = spawn(command, args, { env, stdio: "inherit" });
	child.on("error", (error) => {
		console.error(`Could not start ${command}: ${error.message}`);
		process.exitCode = 1;
	});
	child.on("exit", (code, signal) => {
		process.exitCode = code ?? (signal ? 1 : 0);
	});
}
