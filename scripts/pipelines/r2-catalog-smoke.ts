import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeRuntime } from "@effect/platform-node";
import {
	ToolProcessSpawnerLive,
	runToolProcess,
	requireSuccessfulToolProcess,
	type ToolProcessPolicy,
	type ToolProcessSpec,
	type ToolProcessSpawner,
} from "@sketchi/diagram-scenarios/internal/tool-process";
import { Clock, Effect, Schedule, Schema } from "effect";
import {
	isTransientHttpStatus,
	retryAfterDelayMs,
	pollRetryDelayMs,
	r2SqlApiUrl,
	r2SqlErrorSummary,
	R2SqlQueryError,
	requireToken,
	sqlStringLiteral,
} from "./r2-sql.ts";

export {
	isR2SqlSuccess,
	r2SqlApiUrl,
	r2SqlErrorSummary,
	requireToken,
	sqlStringLiteral,
} from "./r2-sql.ts";

const DEFAULT_ACCOUNT_ID = "75f9660f39e4dafe8b95980b87e7399a";
const DEFAULT_NAMESPACE = "smoke";
const DEFAULT_TABLE = "events";
const DEFAULT_TOKEN_ENV = "WRANGLER_R2_SQL_AUTH_TOKEN";
const DEFAULT_OUTPUT_DIR = ".memory/r2-catalog-smoke";
const PIPELINE_READY_STATUSES = new Set(["active", "running"]);
const PIPELINE_FAILED_STATUSES = new Set(["failed", "errored"]);

export const commandPolicy: ToolProcessPolicy = {
	timeoutMs: 120_000,
	closeGraceMs: 1_000,
	hardKillGraceMs: 2_000,
	forceSettleGraceMs: 1_000,
};

export interface PollPolicy {
	readonly attempts: number;
	readonly initialDelayMs: number;
	readonly delayMs: number;
	readonly attemptTimeoutMs: number;
}
export const queryPollPolicy: PollPolicy = {
	attempts: 8,
	initialDelayMs: 65_000,
	delayMs: 30_000,
	attemptTimeoutMs: 30_000,
};
const pipelinePollPolicy: PollPolicy = {
	attempts: 12,
	initialDelayMs: 0,
	delayMs: 5_000,
	attemptTimeoutMs: 30_000,
};

interface NamesInput {
	accountId?: string | undefined;
	base?: string | undefined;
	bucket?: string | undefined;
	namespace?: string | undefined;
	suffix?: string | undefined;
	table?: string | undefined;
}
type CatalogNames = ReturnType<typeof catalogSmokeNames>;
type ResourceKind = "bucket" | "catalog" | "stream" | "sink" | "pipeline";
export interface CatalogSmokeContext {
	readonly accountId: string;
	readonly cleanup: boolean;
	readonly created: Set<ResourceKind>;
	readonly env: NodeJS.ProcessEnv;
	readonly names: CatalogNames;
	readonly outputDir: string;
	readonly secrets: readonly string[];
	readonly token: string;
	streamEndpoint?: string | undefined;
}
const PipelineDetails = Schema.Struct({
	result: Schema.optionalKey(Schema.Struct({ status: Schema.optionalKey(Schema.String) })),
	status: Schema.optionalKey(Schema.String),
});
const R2SqlResponse = Schema.Struct({
	success: Schema.Boolean,
	result: Schema.optionalKey(
		Schema.Struct({ rows: Schema.optionalKey(Schema.Array(Schema.Unknown)) }),
	),
});
const AggregateRow = Schema.Struct({
	total_rows: Schema.Union([Schema.String, Schema.Number]),
	min_value: Schema.NullOr(Schema.String),
	max_value: Schema.NullOr(Schema.String),
});
const CloudflareResponse = Schema.Struct({
	success: Schema.Boolean,
	result: Schema.optionalKey(Schema.Array(Schema.Struct({ key: Schema.String }))),
	result_info: Schema.optionalKey(Schema.Struct({ cursor: Schema.optionalKey(Schema.String) })),
});
export function normalizePipelineNamePart(value: string) {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/_{2,}/g, "_");

	if (!normalized || !/^[a-z0-9_]+$/.test(normalized)) {
		throw new Error(`Invalid Pipeline name part "${value}". Use letters, numbers, or underscores.`);
	}

	return normalized;
}

export function catalogSmokeNames(input: NamesInput = {}) {
	const suffix = normalizePipelineNamePart(
		input.suffix ?? new Date().toISOString().replace(/\D/g, "").slice(0, 14),
	);
	const base = normalizePipelineNamePart(input.base ?? `sketchi_r2sql_${suffix}`);
	const bucket =
		input.bucket ??
		base
			.replace(/_/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 63);

	if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(bucket)) {
		throw new Error(`Invalid R2 bucket name "${bucket}".`);
	}

	return {
		base,
		bucket,
		namespace: input.namespace ?? DEFAULT_NAMESPACE,
		pipeline: `${base}_pipeline`,
		sink: `${base}_sink`,
		stream: `${base}_stream`,
		table: input.table ?? DEFAULT_TABLE,
		warehouse: `${input.accountId ?? DEFAULT_ACCOUNT_ID}_${bucket}`,
	};
}

export function aggregateQuery(
	names: Pick<CatalogNames, "namespace" | "table">,
	expectedValue: string,
) {
	return [
		"SELECT",
		"  COUNT(*) AS total_rows,",
		"  MIN(value) AS min_value,",
		"  MAX(value) AS max_value",
		`FROM ${names.namespace}.${names.table}`,
		`WHERE value = ${sqlStringLiteral(expectedValue)}`,
	].join("\n");
}

export function cloudflareErrorSummary(responseBody: unknown) {
	return r2SqlErrorSummary(responseBody);
}

export function redactSecrets(text: string, secrets: readonly string[] = []) {
	let redacted = text;
	for (const secret of secrets) {
		if (secret) {
			redacted = redacted.split(secret).join("[redacted]");
		}
	}
	return redacted;
}

export function streamEndpointFrom(output: string) {
	return output.match(/https:\/\/[a-f0-9]+\.ingest\.cloudflare\.com/)?.[0];
}

export function parseWranglerJsonOutput(text: string): unknown {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end === -1 || end < start) {
		throw new Error("Wrangler did not return a JSON object.");
	}
	return JSON.parse(text.slice(start, end + 1));
}

export function pipelineStatusFrom(details: unknown) {
	const decoded = Schema.decodeUnknownSync(PipelineDetails)(details);
	return (decoded.result?.status ?? decoded.status ?? "").trim().toLowerCase();
}

export function assertAggregateMatches(responseBody: unknown, expectedValue: string): void {
	const body = Schema.decodeUnknownSync(
		Schema.Struct({
			result: Schema.optionalKey(
				Schema.Struct({
					rows: Schema.optionalKey(Schema.Array(Schema.Unknown)),
				}),
			),
		}),
	)(responseBody);
	const row = body.result?.rows?.[0];
	if (row === undefined) {
		throw R2SqlQueryError.make({
			message: "R2 SQL aggregate has no rows yet.",
			retryable: true,
		});
	}
	const aggregate = Schema.decodeUnknownSync(AggregateRow)(row);
	if (!Number.isFinite(Number(aggregate.total_rows)))
		throw new Error("Invalid R2 SQL aggregate row count.");
	if (
		Number(aggregate.total_rows) < 1 ||
		aggregate.min_value !== expectedValue ||
		aggregate.max_value !== expectedValue
	) {
		throw R2SqlQueryError.make({
			message: `Aggregate query did not return the ingested value. Expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(aggregate)}.`,
			retryable: true,
		});
	}
}

export class R2CatalogSmokeError extends Schema.TaggedError<R2CatalogSmokeError>()(
	"R2CatalogSmokeError",
	{
		cause: Schema.optionalKey(Schema.Defect()),
		message: Schema.String,
		operation: Schema.String,
	},
) {}
function smokeError(operation: string, message: string, cause?: unknown) {
	return R2CatalogSmokeError.make({ cause, message, operation });
}
function effectTry<A>(operation: string, run: () => A, message: string) {
	return Effect.try({
		try: run,
		catch: (cause) => smokeError(operation, message, cause),
	});
}
function effectTryPromise<A>(
	operation: string,
	run: (signal: AbortSignal) => Promise<A>,
	message: string,
) {
	return Effect.tryPromise({
		try: run,
		catch: (cause) => smokeError(operation, message, cause),
	});
}
function writeOutputFile(context: CatalogSmokeContext, fileName: string, contents: string) {
	const filePath = join(context.outputDir, fileName);
	return effectTryPromise(
		`write:${fileName}`,
		(signal) => writeFile(filePath, contents, { signal }),
		`Unable to write ${filePath}.`,
	);
}
function parseArgs(args: readonly string[]): Record<string, string | undefined> {
	const parsed: Record<string, string | undefined> = {};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (!arg?.startsWith("--")) throw new Error(`Unexpected positional argument "${arg}".`);
		const key = arg.slice(2);
		const value = args[index + 1];
		if (!value || value.startsWith("--")) {
			parsed[key] = "true";
			continue;
		}
		parsed[key] = value;
		index += 1;
	}
	return parsed;
}
export function resolveAccountId(explicit: string | undefined, env: NodeJS.ProcessEnv): string {
	const configured = env.CLOUDFLARE_ACCOUNT_ID?.trim();
	const legacy = env.CF_ACCOUNT_ID?.trim();
	const identities = [explicit?.trim(), configured, legacy].filter((value) => value !== undefined);
	if (identities.some((value) => !value) || new Set(identities).size > 1) {
		throw new Error(
			"Conflicting or empty Cloudflare account configuration; --account-id, CLOUDFLARE_ACCOUNT_ID, and CF_ACCOUNT_ID must agree.",
		);
	}
	return identities[0] ?? DEFAULT_ACCOUNT_ID;
}

// Register before mutation; record successful creation before interruptible logs.
// Scope release is LIFO, so consumers are removed before their dependencies.
const createOwnedResource = Effect.fn("r2CatalogSmoke.createOwnedResource")(function* (
	context: CatalogSmokeContext,
	resource: ResourceKind,
	label: string,
	args: readonly string[],
	release: Effect.Effect<unknown, unknown, ToolProcessSpawner>,
) {
	yield* Effect.addFinalizer(() =>
		context.cleanup && context.created.has(resource) ? release.pipe(Effect.ignore) : Effect.void,
	);
	return yield* runWrangler(context, label, args, {
		createdResource: resource,
	});
});

const provision = Effect.fn("r2CatalogSmoke.provision")(function* (context: CatalogSmokeContext) {
	yield* createOwnedResource(
		context,
		"bucket",
		"create-bucket",
		["r2", "bucket", "create", context.names.bucket],
		cleanupBucket(context),
	);
	yield* createOwnedResource(
		context,
		"catalog",
		"enable-catalog",
		["r2", "bucket", "catalog", "enable", context.names.bucket],
		cleanupCatalog(context),
	);
	const streamOutput = yield* createOwnedResource(
		context,
		"stream",
		"create-stream",
		[
			"pipelines",
			"streams",
			"create",
			context.names.stream,
			"--schema-file",
			join(context.outputDir, "schema.json"),
			"--http-enabled=true",
			"--http-auth=false",
		],
		runWrangler(context, "delete-stream", [
			"pipelines",
			"streams",
			"delete",
			context.names.stream,
			"--force",
		]),
	);
	context.streamEndpoint = streamEndpointFrom(streamOutput);
	yield* createOwnedResource(
		context,
		"sink",
		"create-sink",
		[
			"pipelines",
			"sinks",
			"create",
			context.names.sink,
			"--type",
			"r2-data-catalog",
			"--bucket",
			context.names.bucket,
			"--namespace",
			context.names.namespace,
			"--table",
			context.names.table,
			"--catalog-token",
			context.token,
			"--format",
			"parquet",
			"--compression",
			"uncompressed",
			"--roll-interval",
			"60",
		],
		runWrangler(context, "delete-sink", [
			"pipelines",
			"sinks",
			"delete",
			context.names.sink,
			"--force",
		]),
	);
	yield* createOwnedResource(
		context,
		"pipeline",
		"create-pipeline",
		[
			"pipelines",
			"create",
			context.names.pipeline,
			"--sql",
			`INSERT INTO ${context.names.sink} SELECT * FROM ${context.names.stream}`,
		],
		runWrangler(context, "delete-pipeline", [
			"pipelines",
			"delete",
			context.names.pipeline,
			"--force",
		]),
	);
	yield* waitForPipelineReady(context);
});

export const pollTransient = Effect.fn("r2CatalogSmoke.pollTransient")(function* <A, E, R>(
	attempt: Effect.Effect<A, E, R>,
	policy: PollPolicy,
) {
	yield* Effect.sleep(policy.initialDelayMs);
	return yield* attempt.pipe(
		Effect.timeoutOrElse({
			duration: policy.attemptTimeoutMs,
			orElse: () =>
				Effect.fail(
					R2SqlQueryError.make({
						message: "Catalog polling attempt timed out.",
						retryable: true,
					}),
				),
		}),
		Effect.retry({
			schedule: Schedule.recurs(policy.attempts - 1).pipe(
				Schedule.addDelay(({ input }) =>
					Effect.succeed(pollRetryDelayMs(input, policy.delayMs, policy.attemptTimeoutMs)),
				),
			),
			while: (error) => error instanceof R2SqlQueryError && error.retryable,
		}),
	);
});
const waitForPipelineReady = Effect.fn("r2CatalogSmoke.waitForPipelineReady")(function* (
	context: CatalogSmokeContext,
) {
	let attemptNumber = 0;
	const attempt = Effect.gen(function* () {
		const output = yield* runWrangler(context, `get-pipeline-${++attemptNumber}`, [
			"pipelines",
			"get",
			context.names.pipeline,
			"--json",
		]);
		const status = yield* effectTry(
			"pipeline:ready-decode",
			() => pipelineStatusFrom(parseWranglerJsonOutput(output)),
			"Pipeline returned malformed details.",
		);
		if (PIPELINE_READY_STATUSES.has(status)) return;
		return yield* Effect.fail(
			R2SqlQueryError.make({
				message: `Pipeline ${context.names.pipeline} status is ${status || "unknown"}.`,
				retryable: !PIPELINE_FAILED_STATUSES.has(status),
			}),
		);
	});
	yield* pollTransient(attempt, pipelinePollPolicy);
});
const ingest = Effect.fn("r2CatalogSmoke.ingest")(function* (
	context: CatalogSmokeContext,
	value?: string,
) {
	const endpoint = context.streamEndpoint;
	if (!endpoint)
		return yield* Effect.fail(
			smokeError(
				"pipeline:ingest",
				`Could not find HTTP endpoint for stream ${context.names.stream}.`,
			),
		);
	const payloadValue = value ?? `r2-catalog-smoke-${new Date().toISOString().replace(/\D/g, "")}`;
	const response = yield* effectTryPromise(
		"pipeline:ingest",
		async (signal) => {
			const response = await fetch(endpoint, {
				body: JSON.stringify([{ value: payloadValue }]),
				headers: { "content-type": "application/json" },
				method: "POST",
				signal,
			});
			return {
				ok: response.ok,
				status: response.status,
				body: await response.text(),
			};
		},
		"Pipeline ingest request failed.",
	).pipe(Effect.timeout(30_000));
	yield* writeOutputFile(
		context,
		"ingest-response.json",
		`${redactSecrets(response.body, context.secrets)}\n`,
	);
	if (!response.ok)
		return yield* Effect.fail(
			smokeError("pipeline:ingest", `Pipeline ingest failed with HTTP ${response.status}.`),
		);
	return payloadValue;
});
export const verifyQueries = Effect.fn("r2CatalogSmoke.verifyQueries")(function* (
	context: CatalogSmokeContext,
	expectedValue: string,
	policy: PollPolicy = queryPollPolicy,
) {
	let attempt = 0;
	yield* pollTransient(
		Effect.gen(function* () {
			attempt += 1;
			yield* runR2SqlQuery(
				context,
				`show-tables-${attempt}`,
				`SHOW TABLES FROM ${context.names.namespace}`,
			);
			yield* runR2SqlQuery(
				context,
				`describe-table-${attempt}`,
				`DESCRIBE ${context.names.namespace}.${context.names.table}`,
			);
			const aggregate = yield* runR2SqlQuery(
				context,
				`aggregate-${attempt}`,
				aggregateQuery(context.names, expectedValue),
			);
			yield* Effect.try({
				try: () => assertAggregateMatches(aggregate, expectedValue),
				catch: (cause) =>
					cause instanceof R2SqlQueryError
						? cause
						: R2SqlQueryError.make({
								cause,
								message: "Malformed R2 SQL aggregate response.",
								retryable: false,
							}),
			});
		}),
		policy,
	);
});
export const runR2SqlQuery = Effect.fn("r2CatalogSmoke.runR2SqlQuery")(function* (
	context: CatalogSmokeContext,
	label: string,
	query: string,
) {
	const response = yield* Effect.tryPromise({
		try: async (signal) => {
			const response = await fetch(r2SqlApiUrl(context.accountId, context.names.bucket), {
				body: JSON.stringify({ query, warehouse: context.names.warehouse }),
				headers: {
					authorization: `Bearer ${context.token}`,
					"content-type": "application/json",
				},
				method: "POST",
				signal,
			});
			return {
				ok: response.ok,
				status: response.status,
				retryAfter: response.headers.get("retry-after"),
				text: await response.text(),
			};
		},
		catch: (cause) =>
			R2SqlQueryError.make({
				cause,
				message: `${label} R2 SQL request or body read failed.`,
				retryable: true,
			}),
	});
	yield* writeOutputFile(
		context,
		`${label}.json`,
		`${redactSecrets(response.text, context.secrets)}\n`,
	);
	if (!response.ok) {
		const retryAfterMs = retryAfterDelayMs(response.retryAfter, yield* Clock.currentTimeMillis);
		return yield* Effect.fail(
			R2SqlQueryError.make({
				status: response.status,
				message: `${label} failed with HTTP ${response.status}.`,
				retryable: isTransientHttpStatus(response.status),
				...(retryAfterMs === undefined ? {} : { retryAfterMs }),
			}),
		);
	}
	const body = yield* Effect.try({
		try: () => Schema.decodeUnknownSync(R2SqlResponse)(JSON.parse(response.text)),
		catch: (cause) =>
			R2SqlQueryError.make({
				cause,
				message: `${label} returned malformed R2 SQL response.`,
				retryable: false,
			}),
	});
	if (!body.success)
		return yield* Effect.fail(
			R2SqlQueryError.make({
				message: `${label} failed: ${r2SqlErrorSummary(JSON.parse(response.text))}.`,
				retryable: false,
			}),
		);
	return body;
});
const purgeOwnedBucket = Effect.fn("r2CatalogSmoke.purgeOwnedBucket")(function* (
	context: CatalogSmokeContext,
) {
	yield* deleteBucketObjects(context).pipe(
		Effect.catch((error) =>
			writeOutputFile(
				context,
				"delete-objects.log",
				`${redactSecrets(error.message, context.secrets)}\n`,
			).pipe(Effect.ignore),
		),
	);
});
const cleanupCatalog = Effect.fn("r2CatalogSmoke.cleanupCatalog")(function* (
	context: CatalogSmokeContext,
) {
	yield* purgeOwnedBucket(context);
	yield* runWrangler(context, "disable-catalog", [
		"r2",
		"bucket",
		"catalog",
		"disable",
		context.names.bucket,
	]).pipe(Effect.ignore);
});
const cleanupBucket = Effect.fn("r2CatalogSmoke.cleanupBucket")(function* (
	context: CatalogSmokeContext,
) {
	if (!context.created.has("catalog")) yield* purgeOwnedBucket(context);
	yield* runWrangler(context, "delete-bucket", ["r2", "bucket", "delete", context.names.bucket], {
		stdin: "y\n",
	}).pipe(Effect.ignore);
});
const deleteBucketObjects = Effect.fn("r2CatalogSmoke.deleteBucketObjects")(function* (
	context: CatalogSmokeContext,
) {
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const response = yield* callCloudflareApi(context, {
			label: "list-objects",
			query: cursor ? { cursor, per_page: "1000" } : { per_page: "1000" },
		});
		if (!response.result)
			return yield* Effect.fail(
				smokeError(
					"cloudflare-api:list-objects-contract",
					"Cloudflare object listing omitted its result array.",
				),
			);
		keys.push(...response.result.map((object) => object.key));
		cursor = response.result_info?.cursor;
	} while (cursor);
	yield* writeOutputFile(context, "delete-object-keys.json", `${JSON.stringify(keys, null, 2)}\n`);
	for (let index = 0; index < keys.length; index += 1000) {
		yield* callCloudflareApi(context, {
			body: keys.slice(index, index + 1000),
			label: `delete-objects-${index / 1000 + 1}`,
			method: "DELETE",
		});
	}
});
const callCloudflareApi = Effect.fn("r2CatalogSmoke.callCloudflareApi")(function* (
	context: CatalogSmokeContext,
	options: {
		label: string;
		query?: Record<string, string>;
		body?: readonly string[];
		method?: string;
	},
) {
	const url = new URL(
		`https://api.cloudflare.com/client/v4/accounts/${context.accountId}/r2/buckets/${context.names.bucket}/objects`,
	);
	url.search = new URLSearchParams(options.query).toString();
	const response = yield* effectTryPromise(
		`cloudflare-api:${options.label}`,
		async (signal) => {
			const response = await fetch(url, {
				...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
				headers: {
					authorization: `Bearer ${context.token}`,
					"content-type": "application/json",
				},
				method: options.method ?? "GET",
				signal,
			});
			return {
				ok: response.ok,
				status: response.status,
				text: await response.text(),
			};
		},
		`Cloudflare API ${options.label} request failed.`,
	).pipe(
		Effect.timeoutOrElse({
			duration: 30_000,
			orElse: () =>
				Effect.fail(
					smokeError(`cloudflare-api:${options.label}`, "Cloudflare object request timed out."),
				),
		}),
	);
	yield* writeOutputFile(
		context,
		`${options.label}.json`,
		`${redactSecrets(response.text, context.secrets)}\n`,
	);
	if (!response.ok)
		return yield* Effect.fail(
			smokeError(
				`cloudflare-api:${options.label}`,
				`Cloudflare API failed with HTTP ${response.status}.`,
			),
		);
	const body = yield* effectTry(
		`cloudflare-api:${options.label}:decode`,
		() => Schema.decodeUnknownSync(CloudflareResponse)(JSON.parse(response.text)),
		"Cloudflare API returned malformed JSON.",
	);
	if (!body.success)
		return yield* Effect.fail(
			smokeError(`cloudflare-api:${options.label}`, "Cloudflare API object request failed."),
		);
	return body;
});
const runWrangler = Effect.fn("r2CatalogSmoke.runWrangler")(function* (
	context: CatalogSmokeContext,
	label: string,
	args: readonly string[],
	options: { stdin?: string; createdResource?: ResourceKind } = {},
) {
	const spec: ToolProcessSpec = {
		command: "pnpm",
		args: ["exec", "wrangler", ...args, "--config", join(context.outputDir, "wrangler.json")],
		env: context.env,
		...(options.stdin === undefined ? {} : { stdin: options.stdin }),
	};
	return yield* Effect.uninterruptibleMask((restore) =>
		Effect.gen(function* () {
			const result = yield* restore(runToolProcess(spec, commandPolicy));
			if (
				result.exitCode === 0 &&
				result.signal === null &&
				!result.timedOut &&
				options.createdResource !== undefined
			) {
				context.created.add(options.createdResource);
			}
			const output = `${result.stdout}${result.stderr}`;
			yield* restore(
				writeOutputFile(
					context,
					`${label}.log`,
					redactSecrets(
						[`$ ${[basename(spec.command), ...spec.args].join(" ")}`, output.trimEnd(), ""].join(
							"\n",
						),
						context.secrets,
					),
				),
			);
			yield* requireSuccessfulToolProcess(spec, result).pipe(
				Effect.mapError((cause) =>
					smokeError(`command:${label}`, `${label} failed. See ${context.outputDir}.`, cause),
				),
			);
			return output;
		}),
	);
});
export const runCatalogSmoke = Effect.fn("r2CatalogSmoke.run")(function* (
	argv: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
	pollPolicy: PollPolicy = queryPollPolicy,
) {
	if (argv.includes("--help")) {
		yield* Effect.sync(() =>
			console.log(
				"R2 catalog smoke (creates real resources). Options: --account-id ID --bucket NAME --base NAME --suffix VALUE --namespace NAME --table NAME --token-env NAME --output-dir PATH --value VALUE --cleanup false",
			),
		);
		return;
	}
	const { args, context } = yield* effectTry(
		"input",
		() => {
			const args = parseArgs(argv);
			const accountId = resolveAccountId(args["account-id"], env);
			const token = requireToken(env, args["token-env"] ?? DEFAULT_TOKEN_ENV);
			const names = catalogSmokeNames({
				accountId,
				base: args.base,
				bucket: args.bucket,
				namespace: args.namespace,
				suffix: args.suffix,
				table: args.table,
			});
			const context: CatalogSmokeContext = {
				accountId,
				cleanup: args.cleanup !== "false",
				created: new Set<ResourceKind>(),
				env: {
					...env,
					CLOUDFLARE_ACCOUNT_ID: accountId,
					CF_ACCOUNT_ID: accountId,
				},
				names,
				outputDir: join(args["output-dir"] ?? DEFAULT_OUTPUT_DIR, names.base),
				secrets: [token],
				token,
			};
			return { args, context };
		},
		"Invalid R2 catalog smoke configuration.",
	);
	yield* effectTryPromise(
		"output:mkdir",
		() => mkdir(context.outputDir, { recursive: true }),
		`Unable to create ${context.outputDir}.`,
	);
	yield* writeOutputFile(
		context,
		"schema.json",
		`${JSON.stringify({ fields: [{ name: "value", type: "string", required: true }] })}\n`,
	);
	// Wrangler config account_id takes precedence over its environment. Pin both
	// identities and bypass unrelated auto-discovered Worker configuration.
	yield* writeOutputFile(
		context,
		"wrangler.json",
		`${JSON.stringify({ account_id: context.accountId })}\n`,
	);
	yield* Effect.scoped(
		Effect.gen(function* () {
			yield* provision(context);
			const expectedValue = yield* ingest(context, args.value);
			yield* verifyQueries(context, expectedValue, pollPolicy);
		}),
	);
});
const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
	NodeRuntime.runMain(
		runCatalogSmoke(process.argv.slice(2)).pipe(
			Effect.provide(ToolProcessSpawnerLive),
			Effect.catch((error) =>
				Effect.sync(() => {
					console.error(error.message);
					process.exitCode = 1;
				}),
			),
		),
	);
}
