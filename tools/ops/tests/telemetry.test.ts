// Telemetry commands through the real entrypoint, with `pnpm` (Wrangler), `duckdb` and
// `infisical` as recording stubs on PATH.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The telemetry operations test reads the generated configuration inputs and file outputs directly.
import { mkdirSync, readFileSync } from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The telemetry operations test reads the generated configuration inputs and file outputs directly.
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { INIT_SQL, VIEWS_SQL } from "../src/telemetry/db";
import { executable, runOps, scratch } from "./harness";

function stubs() {
	const dir = scratch("ops-telemetry-");
	const bin = join(dir, "bin");
	mkdirSync(bin);
	const calls = join(dir, "calls.jsonl");
	for (const name of ["pnpm", "duckdb", "infisical"]) {
		executable(
			join(bin, name),
			`import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ name: ${JSON.stringify(name)}, args, env: process.env.TELEMETRY_ENV ?? null }) + "\\n");
if (${JSON.stringify(name)} === "pnpm") {
	const command = args.slice(2).join(" ");
	if (command.includes(" list ") || command.endsWith(" list") || command.includes("--json")) { console.log("[]"); process.exit(0); }
	const token = args[args.indexOf("--token") + 1];
	if (args.includes("--token")) { console.error("✘ [ERROR] Request with token " + token + " was rejected [code: 10000]"); process.exit(1); }
}
`,
		);
	}
	return {
		// @effect-diagnostics-next-line processEnv:off -- The subprocess test prepends fixture binaries to the real host PATH.
		env: { PATH: `${bin}:${process.env["PATH"]}` },
		calls: () =>
			readFileSync(calls, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { name: string; args: string[]; env: string | null }),
	};
}

describe("telemetry", () => {
	test("a failed provisioning step reports Wrangler's error without the catalog token", () => {
		const token = "cfut_catalog_admin_secret";
		const stub = stubs();
		const result = runOps(["telemetry", "provision", "preview"], {
			env: { ...stub.env, WRANGLER_R2_SQL_AUTH_TOKEN: token },
		});
		expect(result.status).toBe(1);
		const output = result.stdout + result.stderr;
		expect(output).not.toContain(token);
		expect(result.stderr).toMatch(
			/wrangler basin catalog compaction enable .* --token \[redacted\] failed with exit status 1/,
		);
		expect(result.stderr).toMatch(/Request with token \[redacted\] was rejected/);
		// The token did reach Wrangler, which needs it.
		expect(stub.calls().some(({ args }) => args.includes(token))).toBe(true);
	});

	test("pnpm db runs DuckDB on the init file directly with a token, and through Infisical without", () => {
		const stub = stubs();
		const direct = runOps(["db", "--", "--preview", "-c", "FROM spans"], {
			env: { ...stub.env, R2_DATA_READ_TOKEN: "read-token" },
		});
		expect(direct.status, direct.stderr).toBe(0);
		const viaInfisical = runOps(["db", "--"], { env: { ...stub.env, R2_DATA_READ_TOKEN: "" } });
		expect(viaInfisical.status, viaInfisical.stderr).toBe(0);
		const opening = (environment: string) => [
			"-init",
			INIT_SQL,
			"-cmd",
			expect.stringContaining(`_sketchi-telemetry-${environment}' AS telemetry`),
			"-cmd",
			`.read "${VIEWS_SQL}"`,
		];
		expect(stub.calls()).toEqual([
			{ name: "duckdb", args: [...opening("preview"), "-c", "FROM spans"], env: "preview" },
			{
				name: "infisical",
				args: [
					"run",
					"--projectId",
					"bb3fe729-e290-4740-84d4-304752f0d719",
					"--env",
					"prod",
					"--silent",
					"--",
					"duckdb",
					...opening("production"),
				],
				env: "production",
			},
		]);
	});
});
