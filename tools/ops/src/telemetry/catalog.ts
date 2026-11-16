// Span storage: one Pipeline stream per environment feeding an Iceberg table in that
// environment's telemetry bucket. `resources` prints the map; `provision` creates whatever is
// missing and applies catalog maintenance.
import { Config, Console, Effect, Option, Redacted } from "effect";

import { optionalEnv } from "../outputs";
import { capture, opsError } from "../process";

export const ACCOUNT_ID = "75f9660f39e4dafe8b95980b87e7399a";
const PROJECT = "sketchi";
const NAMESPACE = "observability";
const TABLE = "spans";
export const ENVIRONMENTS = ["production", "preview"] as const;
export type TelemetryEnvironment = (typeof ENVIRONMENTS)[number];
// Pipelines' minimum. Rows become queryable about one interval after they are sent.
const ROLL_INTERVAL_SECONDS = 60;
const COMPACTION_TARGET_MB = 128;
const SNAPSHOT_MAX_AGE_DAYS = 7;
const SNAPSHOTS_RETAINED = 5;
const CATALOG_TOKEN_ENV = "WRANGLER_R2_SQL_AUTH_TOKEN";
const SCHEMA_FILE = new URL("../../../../packages/observability/spans.schema.json", import.meta.url)
	.pathname;

export function telemetryTarget(environment: TelemetryEnvironment, accountId = ACCOUNT_ID) {
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

type Target = ReturnType<typeof telemetryTarget>;

interface ExistingState {
	readonly buckets: ReadonlySet<string>;
	readonly streams: ReadonlySet<string>;
	readonly sinks: ReadonlySet<string>;
	readonly pipelines: ReadonlySet<string>;
}

/** The wrangler argument lists that create one environment's resources, in order. */
export function provisionSteps(target: Target, catalogToken: Redacted.Redacted<string>) {
	const token = Redacted.value(catalogToken);
	return [
		{
			exists: (state: ExistingState) => state.buckets.has(target.bucket),
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
				token,
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
				token,
			],
			label: "snapshot expiration",
		},
		{
			exists: (state: ExistingState) => state.streams.has(target.stream),
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
			exists: (state: ExistingState) => state.sinks.has(target.sink),
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
				token,
			],
			label: `sink ${target.sink}`,
		},
		{
			exists: (state: ExistingState) => state.pipelines.has(target.pipeline),
			args: ["pipelines", "create", target.pipeline, "--sql", target.pipelineSql],
			label: `pipeline ${target.pipeline}`,
		},
	];
}

const SECRET_FLAGS = new Set(["--catalog-token", "--token"]);
const REDACTED = "[redacted]";

/** The failure of `wrangler <args>` without its secrets: they never reach the message. */
export function wranglerFailure(args: readonly string[], status: number | string, stderr: string) {
	const secrets = args.filter((_, index) => SECRET_FLAGS.has(args[index - 1] ?? ""));
	const redact = (text: string) =>
		secrets.reduce((redacted, secret) => redacted.replaceAll(secret, REDACTED), text);
	const command = args
		.map((arg, index) => (SECRET_FLAGS.has(args[index - 1] ?? "") ? REDACTED : arg))
		.join(" ");
	const detail = redact(stderr.trim());
	return opsError(
		`wrangler ${command} failed with exit status ${status}${detail ? `:\n${detail}` : "."}`,
	);
}

const wranglerEnv = Effect.gen(function* () {
	const accountId = yield* optionalEnv("CLOUDFLARE_ACCOUNT_ID");
	return { CLOUDFLARE_ACCOUNT_ID: Option.getOrElse(accountId, () => ACCOUNT_ID) };
});

export const wrangler = Effect.fn("ops.telemetry.wrangler")(function* (args: readonly string[]) {
	const result = yield* capture("pnpm", ["exec", "wrangler", ...args], {
		env: yield* wranglerEnv,
	}).pipe(Effect.mapError((error) => wranglerFailure(args, "unknown", error.message)));
	if (result.code !== 0) return yield* wranglerFailure(args, result.code, result.stderr);
	return result.stdout;
});

/**
 * `id`/`name` pairs from a `--json` listing. `sinks list --json` prints Node's inspect format
 * rather than JSON, so this reads both.
 */
function listedResources(output: string) {
	const pattern = /["']?id["']?:\s*["']([^"']+)["'],\s*["']?name["']?:\s*["']([^"']+)["']/g;
	return [...output.matchAll(pattern)].map(([, id, name]) => ({ id: id ?? "", name: name ?? "" }));
}

const listed = (args: readonly string[]) =>
	wrangler([...args, "--json", "--per-page", "100"]).pipe(Effect.map(listedResources));

const names = (args: readonly string[]) =>
	listed(args).pipe(Effect.map((items) => new Set(items.map((item) => item.name))));

const existingState = Effect.fn("ops.telemetry.state")(function* (targets: readonly Target[]) {
	const buckets = new Set<string>();
	for (const target of targets) {
		// `info` fails for a missing bucket.
		const info = yield* capture(
			"pnpm",
			["exec", "wrangler", "r2", "bucket", "info", target.bucket],
			{
				env: yield* wranglerEnv,
			},
		).pipe(Effect.orElseSucceed(() => ({ code: 1 })));
		if (info.code === 0) buckets.add(target.bucket);
	}
	return {
		buckets,
		pipelines: yield* names(["pipelines", "list"]),
		sinks: yield* names(["pipelines", "sinks", "list"]),
		streams: yield* names(["pipelines", "streams", "list"]),
	} satisfies ExistingState;
});

export function telemetryEnvironments(environment: string) {
	if (environment === "all") return Effect.succeed([...ENVIRONMENTS]);
	return ENVIRONMENTS.includes(environment as TelemetryEnvironment)
		? Effect.succeed([environment as TelemetryEnvironment])
		: Effect.fail(
				opsError(`Unknown environment "${environment}". Use ${ENVIRONMENTS.join(" or ")}.`),
			);
}

export const printResources = Effect.fn("ops.telemetry.resources")(function* (environment: string) {
	const environments = yield* telemetryEnvironments(environment);
	yield* Console.log(
		JSON.stringify({ resources: environments.map((env) => telemetryTarget(env)) }, null, 2),
	);
});

export const provision = Effect.fn("ops.telemetry.provision")(function* (environment: string) {
	const environments = yield* telemetryEnvironments(environment);
	const catalogToken = yield* Config.option(Config.Redacted(CATALOG_TOKEN_ENV)).pipe(Effect.orDie);
	if (Option.isNone(catalogToken)) {
		return yield* opsError(
			`${CATALOG_TOKEN_ENV} must hold a token with Basin Catalog admin access.`,
		);
	}
	const targets = environments.map((env) => telemetryTarget(env));
	const state = yield* existingState(targets);
	for (const target of targets) {
		for (const step of provisionSteps(target, catalogToken.value)) {
			if (step.exists?.(state)) {
				yield* Console.log(`${target.environment}: ${step.label} exists`);
				continue;
			}
			yield* Console.log(`${target.environment}: ${step.label}`);
			yield* wrangler(step.args);
		}
		const streams = yield* listed(["pipelines", "streams", "list"]);
		const id = streams.find((stream) => stream.name === target.stream)?.id;
		yield* Console.log(`${target.environment}: stream id ${id}`);
	}
});
