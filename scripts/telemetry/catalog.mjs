// Span storage: one Pipeline stream per environment feeding an Iceberg table in
// that environment's telemetry bucket. `resources` prints the map; `provision`
// creates whatever is missing and applies catalog maintenance.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ACCOUNT_ID = "75f9660f39e4dafe8b95980b87e7399a";
export const PROJECT = "sketchi";
export const NAMESPACE = "observability";
export const TABLE = "spans";
export const ENVIRONMENTS = ["production", "preview"];
// Pipelines' minimum. Rows become queryable about one interval after they are sent.
export const ROLL_INTERVAL_SECONDS = 60;
export const COMPACTION_TARGET_MB = 128;
export const SNAPSHOT_MAX_AGE_DAYS = 7;
export const SNAPSHOTS_RETAINED = 5;
const CATALOG_TOKEN_ENV = "WRANGLER_R2_SQL_AUTH_TOKEN";
const SCHEMA_FILE = fileURLToPath(
	new URL("../../packages/observability/spans.schema.json", import.meta.url),
);

export function telemetryTarget(environment, accountId = ACCOUNT_ID) {
	if (!ENVIRONMENTS.includes(environment)) {
		throw new Error(`Unknown environment "${environment}". Use ${ENVIRONMENTS.join(" or ")}.`);
	}
	const bucket = `${PROJECT}-telemetry-${environment}`;
	const stream = `${PROJECT}_telemetry_spans_${environment}`;
	const sink = `${stream}_catalog`;
	return {
		bucket,
		catalogUri: `https://catalog.cloudflarestorage.com/${accountId}/${bucket}`,
		environment,
		namespace: NAMESPACE,
		pipeline: `${stream}_to_catalog`,
		pipelineSql: `INSERT INTO ${sink} SELECT * FROM ${stream}`,
		sink,
		stream,
		table: TABLE,
		warehouse: `${accountId}_${bucket}`,
	};
}

export function telemetryTargets(accountId = ACCOUNT_ID) {
	return ENVIRONMENTS.map((environment) => telemetryTarget(environment, accountId));
}

/** The wrangler argument lists that create one environment's resources, in order. */
export function provisionSteps(target, catalogToken) {
	return [
		{
			exists: (state) => state.buckets.has(target.bucket),
			args: ["r2", "bucket", "create", target.bucket],
			label: `bucket ${target.bucket}`,
		},
		{ args: ["basin", "catalog", "enable", target.bucket], label: "catalog" },
		{
			args: [
				"basin",
				"catalog",
				"compaction",
				"enable",
				target.bucket,
				"--target-size",
				String(COMPACTION_TARGET_MB),
				"--token",
				catalogToken,
			],
			label: "compaction",
		},
		{
			args: [
				"basin",
				"catalog",
				"snapshot-expiration",
				"enable",
				target.bucket,
				"--older-than-days",
				String(SNAPSHOT_MAX_AGE_DAYS),
				"--retain-last",
				String(SNAPSHOTS_RETAINED),
				"--token",
				catalogToken,
			],
			label: "snapshot expiration",
		},
		{
			exists: (state) => state.streams.has(target.stream),
			args: [
				"pipelines",
				"streams",
				"create",
				target.stream,
				"--schema-file",
				SCHEMA_FILE,
				"--http-enabled",
				"false",
			],
			label: `stream ${target.stream}`,
		},
		{
			exists: (state) => state.sinks.has(target.sink),
			args: [
				"pipelines",
				"sinks",
				"create",
				target.sink,
				"--type",
				"r2-data-catalog",
				"--bucket",
				target.bucket,
				"--namespace",
				target.namespace,
				"--table",
				target.table,
				"--roll-interval",
				String(ROLL_INTERVAL_SECONDS),
				"--compression",
				"zstd",
				"--catalog-token",
				catalogToken,
			],
			label: `sink ${target.sink}`,
		},
		{
			exists: (state) => state.pipelines.has(target.pipeline),
			args: ["pipelines", "create", target.pipeline, "--sql", target.pipelineSql],
			label: `pipeline ${target.pipeline}`,
		},
	];
}

function wrangler(args) {
	return execFileSync("pnpm", ["exec", "wrangler", ...args], {
		encoding: "utf8",
		env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? ACCOUNT_ID },
		stdio: ["ignore", "pipe", "inherit"],
	});
}

/**
 * `id`/`name` pairs from a `--json` listing. `sinks list --json` prints Node's inspect
 * format rather than JSON, so this reads both.
 */
export function listedResources(output) {
	const pattern = /["']?id["']?:\s*["']([^"']+)["'],\s*["']?name["']?:\s*["']([^"']+)["']/g;
	return [...output.matchAll(pattern)].map(([, id, name]) => ({ id, name }));
}

function listed(args) {
	return listedResources(wrangler([...args, "--json", "--per-page", "100"]));
}

function names(args) {
	return new Set(listed(args).map((item) => item.name));
}

function existingState(targets) {
	const buckets = new Set();
	for (const target of targets) {
		try {
			execFileSync("pnpm", ["exec", "wrangler", "r2", "bucket", "info", target.bucket], {
				env: {
					...process.env,
					CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? ACCOUNT_ID,
				},
				stdio: "ignore",
			});
			buckets.add(target.bucket);
		} catch {
			// `info` fails for a missing bucket.
		}
	}
	return {
		buckets,
		pipelines: names(["pipelines", "list"]),
		sinks: names(["pipelines", "sinks", "list"]),
		streams: names(["pipelines", "streams", "list"]),
	};
}

function streamId(target) {
	return listed(["pipelines", "streams", "list"]).find((stream) => stream.name === target.stream)
		?.id;
}

function provision(environments) {
	const catalogToken = process.env[CATALOG_TOKEN_ENV];
	if (!catalogToken) {
		throw new Error(`${CATALOG_TOKEN_ENV} must hold a token with Basin Catalog admin access.`);
	}
	const targets = environments.map((environment) => telemetryTarget(environment));
	const state = existingState(targets);
	for (const target of targets) {
		for (const step of provisionSteps(target, catalogToken)) {
			if (step.exists?.(state)) {
				console.log(`${target.environment}: ${step.label} exists`);
				continue;
			}
			console.log(`${target.environment}: ${step.label}`);
			wrangler(step.args);
		}
		console.log(`${target.environment}: stream id ${streamId(target)}`);
	}
}

function main() {
	const [command, environment = "all"] = process.argv.slice(2);
	const environments = environment === "all" ? ENVIRONMENTS : [environment];
	if (command === "resources") {
		console.log(
			JSON.stringify({ resources: environments.map((env) => telemetryTarget(env)) }, null, 2),
		);
		return;
	}
	if (command === "provision") {
		provision(environments);
		return;
	}
	throw new Error(`Unknown command "${command ?? ""}". Use "resources" or "provision".`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
