import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { NodeRuntime } from "@effect/platform-node";
import { Context, Effect, Layer, Schema } from "effect";

const DEFAULT_ACCOUNT_ID = "75f9660f39e4dafe8b95980b87e7399a";
const DEFAULT_NAMESPACE = "smoke";
const DEFAULT_TABLE = "events";
const DEFAULT_TOKEN_ENV = "WRANGLER_R2_SQL_AUTH_TOKEN";
const DEFAULT_OUTPUT_DIR = ".memory/r2-catalog-smoke";
const R2_SQL_API_BASE = "https://api.sql.cloudflarestorage.com/api/v1";
const POLL_ATTEMPTS = 8;
const INITIAL_POLL_DELAY_MS = 65_000;
const POLL_DELAY_MS = 30_000;
const PIPELINE_READY_ATTEMPTS = 12;
const PIPELINE_READY_DELAY_MS = 5_000;
const PIPELINE_READY_STATUSES = new Set(["active", "running"]);
const PIPELINE_FAILED_STATUSES = new Set(["failed", "errored"]);

export function normalizePipelineNamePart(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");

  if (!normalized || !/^[a-z0-9_]+$/.test(normalized)) {
    throw new Error(
      `Invalid Pipeline name part "${value}". Use letters, numbers, or underscores.`,
    );
  }

  return normalized;
}

export function catalogSmokeNames(input = {}) {
  const suffix = normalizePipelineNamePart(
    input.suffix ?? new Date().toISOString().replace(/\D/g, "").slice(0, 14),
  );
  const base = normalizePipelineNamePart(
    input.base ?? `sketchi_r2sql_${suffix}`,
  );
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

export function sqlStringLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function aggregateQuery(names, expectedValue) {
  return [
    "SELECT",
    "  COUNT(*) AS total_rows,",
    "  MIN(value) AS min_value,",
    "  MAX(value) AS max_value",
    `FROM ${names.namespace}.${names.table}`,
    `WHERE value = ${sqlStringLiteral(expectedValue)}`,
  ].join("\n");
}

export function r2SqlApiUrl(accountId, bucket) {
  return `${R2_SQL_API_BASE}/accounts/${accountId}/r2-sql/query/${bucket}`;
}

export function isR2SqlSuccess(responseBody) {
  return responseBody?.success === true;
}

export function r2SqlErrorSummary(responseBody) {
  const errors = responseBody?.errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return "unknown R2 SQL error";
  }

  return errors
    .map((error) => `${error.code ?? "unknown"}: ${error.message ?? error}`)
    .join("; ");
}

export function cloudflareErrorSummary(responseBody) {
  const errors = responseBody?.errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return "unknown Cloudflare API error";
  }

  return errors
    .map((error) => `${error.code ?? "unknown"}: ${error.message ?? error}`)
    .join("; ");
}

export function redactSecrets(text, secrets = []) {
  let redacted = String(text ?? "");
  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.split(secret).join("[redacted]");
    }
  }
  return redacted;
}

export function streamEndpointFrom(output) {
  return String(output ?? "").match(
    /https:\/\/[a-f0-9]+\.ingest\.cloudflare\.com/,
  )?.[0];
}

export function requireToken(env, tokenEnv = DEFAULT_TOKEN_ENV) {
  const token = env[tokenEnv]?.trim();
  if (!token) {
    throw new Error(
      `${tokenEnv} is required. Use an R2 API token with Admin Read & Write permissions; Wrangler OAuth tokens can list catalog metadata but are not a reliable catalog sink or R2 SQL data-scan credential.`,
    );
  }
  return token;
}

export function parseWranglerJsonOutput(output) {
  const text = String(output ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Wrangler did not return a JSON object.");
  }
  return JSON.parse(text.slice(start, end + 1));
}

export function pipelineStatusFrom(details) {
  const result = details?.result ?? details;
  return typeof result?.status === "string"
    ? result.status.trim().toLowerCase()
    : "";
}

export function assertAggregateMatches(responseBody, expectedValue) {
  const row = responseBody?.result?.rows?.[0];
  const totalRows = Number(row?.total_rows ?? 0);
  if (
    !row ||
    totalRows < 1 ||
    row.min_value !== expectedValue ||
    row.max_value !== expectedValue
  ) {
    throw new Error(
      `Aggregate query did not return the ingested value. Expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(row ?? null)}.`,
    );
  }
}

export class R2CatalogSmokeError extends Schema.TaggedErrorClass()(
  "R2CatalogSmokeError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    message: Schema.String,
    operation: Schema.String,
  },
) {}

export class CatalogSmokeCommandRunner extends Context.Service()(
  "CatalogSmokeCommandRunner",
) {}

function smokeError(operation, message, cause) {
  return R2CatalogSmokeError.make({ cause, message, operation });
}

function effectTry(operation, run, message) {
  return Effect.try({
    try: run,
    catch: (cause) => smokeError(operation, message, cause),
  });
}

function effectTryPromise(operation, run, message) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => smokeError(operation, message, cause),
  });
}

function writeOutputFile(context, fileName, contents) {
  const filePath = join(context.outputDir, fileName);
  return effectTryPromise(
    `write:${fileName}`,
    () => writeFile(filePath, contents),
    `Unable to write ${filePath}.`,
  );
}

function signalCommandTree(state, signal) {
  const pid = state.child.pid;
  if (pid === undefined) return false;
  if (process.platform === "win32") {
    const result = spawnSync(
      "taskkill",
      ["/pid", String(pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])],
      { stdio: "ignore", windowsHide: true },
    );
    if (result.error) throw result.error;
    if (result.status === 0 || state.event !== undefined) {
      return result.status === 0;
    }
    throw new Error(
      `taskkill could not send ${signal} to process tree ${String(pid)}.`,
    );
  }
  if (state.processGroupId === undefined) return state.child.kill(signal);
  try {
    process.kill(-state.processGroupId, signal);
    return true;
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "ESRCH"
    ) {
      return state.child.kill(signal);
    }
    throw cause;
  }
}

function makeNodeCommandState(spec) {
  const ownsProcessGroup = process.platform !== "win32";
  const child = spawn(spec.command, spec.args, {
    detached: ownsProcessGroup,
    env: spec.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const state = {
    child,
    event: undefined,
    processGroupId: ownsProcessGroup ? child.pid : undefined,
    stderr: [],
    stdout: [],
    subscribers: new Set(),
  };
  child.stdout.on("data", (chunk) => state.stdout.push(chunk));
  child.stderr.on("data", (chunk) => state.stderr.push(chunk));
  const settle = (event) => {
    if (state.event !== undefined) return;
    state.event = event;
    for (const subscriber of state.subscribers) subscriber(event);
    state.subscribers.clear();
  };
  child.once("error", (cause) =>
    settle({
      _tag: "Failure",
      error: smokeError(
        `command:${spec.label}`,
        `${spec.label} could not start.`,
        cause,
      ),
    }),
  );
  child.once("close", (exitCode, signal) =>
    settle({ _tag: "Success", exitCode, signal }),
  );
  child.stdin.end(spec.input);
  return state;
}

function awaitNodeCommand(state) {
  return Effect.callback((resume) => {
    const complete = (event) => {
      resume(
        event._tag === "Failure"
          ? Effect.fail(event.error)
          : Effect.succeed({
              exitCode: event.exitCode,
              signal: event.signal,
              stderr: Buffer.concat(state.stderr).toString("utf8"),
              stdout: Buffer.concat(state.stdout).toString("utf8"),
            }),
      );
    };
    if (state.event !== undefined) {
      complete(state.event);
      return;
    }
    state.subscribers.add(complete);
    return Effect.sync(() => {
      state.subscribers.delete(complete);
    });
  });
}

function releaseNodeCommand(state) {
  return effectTry(
    "command:release",
    () => signalCommandTree(state, "SIGKILL"),
    "Unable to terminate the command process tree.",
  ).pipe(
    Effect.ignore,
    Effect.andThen(
      Effect.sync(() => {
        state.child.stdout.destroy();
        state.child.stderr.destroy();
        state.subscribers.clear();
      }),
    ),
  );
}

export const CatalogSmokeCommandRunnerLive = Layer.succeed(
  CatalogSmokeCommandRunner,
  {
    run: (spec) =>
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* Effect.acquireRelease(
            effectTry(
              `command:${spec.label}`,
              () => makeNodeCommandState(spec),
              `${spec.label} could not start.`,
            ),
            releaseNodeCommand,
          );
          return yield* awaitNodeCommand(state);
        }),
      ),
  },
);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument "${arg}".`);
    }
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

const provision = Effect.fn("r2CatalogSmoke.provision")(function* (context) {
  const schemaFile = join(context.outputDir, "schema.json");

  yield* runWrangler(context, "create-bucket", [
    "r2",
    "bucket",
    "create",
    context.names.bucket,
  ]);
  yield* runWrangler(context, "enable-catalog", [
    "r2",
    "bucket",
    "catalog",
    "enable",
    context.names.bucket,
  ]);
  const streamOutput = yield* runWrangler(context, "create-stream", [
    "pipelines",
    "streams",
    "create",
    context.names.stream,
    "--schema-file",
    schemaFile,
    "--http-enabled=true",
    "--http-auth=false",
  ]);
  context.streamEndpoint = streamEndpointFrom(streamOutput);

  yield* runWrangler(context, "create-sink", [
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
  ]);
  yield* runWrangler(context, "create-pipeline", [
    "pipelines",
    "create",
    context.names.pipeline,
    "--sql",
    `INSERT INTO ${context.names.sink} SELECT * FROM ${context.names.stream}`,
  ]);
  yield* waitForPipelineReady(context);
});

const waitForPipelineReady = Effect.fn("r2CatalogSmoke.waitForPipelineReady")(
  function* (context) {
    let lastStatus = "unknown";
    for (let attempt = 1; attempt <= PIPELINE_READY_ATTEMPTS; attempt += 1) {
      const output = yield* runWrangler(context, `get-pipeline-${attempt}`, [
        "pipelines",
        "get",
        context.names.pipeline,
        "--json",
      ]);
      const details = yield* effectTry(
        "pipeline:ready-decode",
        () => parseWranglerJsonOutput(output),
        `Pipeline ${context.names.pipeline} returned malformed details.`,
      );
      const status = pipelineStatusFrom(details);

      if (PIPELINE_READY_STATUSES.has(status)) {
        return;
      }
      if (PIPELINE_FAILED_STATUSES.has(status)) {
        return yield* Effect.fail(
          smokeError(
            "pipeline:ready",
            `Pipeline ${context.names.pipeline} failed before ingest. See ${context.outputDir}.`,
          ),
        );
      }

      lastStatus = status || "unknown";
      yield* Effect.sleep(PIPELINE_READY_DELAY_MS);
    }

    return yield* Effect.fail(
      smokeError(
        "pipeline:ready",
        `Pipeline ${context.names.pipeline} was not ready after ${PIPELINE_READY_ATTEMPTS} checks; last status was ${lastStatus}. See ${context.outputDir}.`,
      ),
    );
  },
);

const ingest = Effect.fn("r2CatalogSmoke.ingest")(function* (context, value) {
  const endpoint = context.streamEndpoint;
  if (!endpoint) {
    return yield* Effect.fail(
      smokeError(
        "pipeline:ingest",
        `Could not find HTTP endpoint for stream ${context.names.stream}.`,
      ),
    );
  }

  const payloadValue =
    value ?? `r2-catalog-smoke-${new Date().toISOString().replace(/\D/g, "")}`;
  const response = yield* effectTryPromise(
    "pipeline:ingest",
    (signal) =>
      fetch(endpoint, {
        body: JSON.stringify([{ value: payloadValue }]),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal,
      }),
    "Pipeline ingest request failed.",
  );
  const body = yield* effectTryPromise(
    "pipeline:ingest-body",
    () => response.text(),
    "Pipeline ingest response could not be read.",
  );
  yield* writeOutputFile(context, "ingest-response.json", `${body}\n`);
  if (!response.ok) {
    return yield* Effect.fail(
      smokeError(
        "pipeline:ingest",
        `Pipeline ingest failed with HTTP ${response.status}: ${body}`,
      ),
    );
  }
  return payloadValue;
});

const verifyQueries = Effect.fn("r2CatalogSmoke.verifyQueries")(
  function* (context, expectedValue) {
    let lastError = null;
    for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
      yield* Effect.sleep(
        attempt === 1 ? INITIAL_POLL_DELAY_MS : POLL_DELAY_MS,
      );
      const verified = yield* Effect.gen(function* () {
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
        yield* effectTry(
          "r2-sql:aggregate-contract",
          () => assertAggregateMatches(aggregate, expectedValue),
          "R2 SQL aggregate did not contain the ingested value.",
        );
        return true;
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            lastError = error;
            return false;
          }),
        ),
      );
      if (verified) return;
    }
    return yield* Effect.fail(
      lastError ??
        smokeError("r2-sql:verify", "R2 SQL verification did not complete."),
    );
  },
);

const runR2SqlQuery = Effect.fn("r2CatalogSmoke.runR2SqlQuery")(
  function* (context, label, query) {
    const response = yield* effectTryPromise(
      `r2-sql:${label}`,
      (signal) =>
        fetch(r2SqlApiUrl(context.accountId, context.names.bucket), {
          body: JSON.stringify({
            query,
            warehouse: context.names.warehouse,
          }),
          headers: {
            authorization: `Bearer ${context.token}`,
            "content-type": "application/json",
          },
          method: "POST",
          signal,
        }),
      `${label} R2 SQL request failed.`,
    );
    const bodyText = yield* effectTryPromise(
      `r2-sql:${label}:body`,
      () => response.text(),
      `${label} R2 SQL response could not be read.`,
    );
    const redactedBody = redactSecrets(bodyText, context.secrets);
    yield* writeOutputFile(context, `${label}.json`, `${redactedBody}\n`);

    const body = yield* effectTry(
      `r2-sql:${label}:decode`,
      () => JSON.parse(bodyText),
      `${label} returned malformed R2 SQL response with HTTP ${response.status}. See ${context.outputDir}.`,
    );

    if (!response.ok || !isR2SqlSuccess(body)) {
      return yield* Effect.fail(
        smokeError(
          `r2-sql:${label}`,
          `${label} failed with HTTP ${response.status}: ${r2SqlErrorSummary(body)}. See ${context.outputDir}.`,
        ),
      );
    }

    return body;
  },
);

const cleanup = Effect.fn("r2CatalogSmoke.cleanup")(function* (context) {
  yield* runWrangler(context, "delete-pipeline", [
    "pipelines",
    "delete",
    context.names.pipeline,
    "--force",
  ]).pipe(Effect.ignore);
  yield* runWrangler(context, "delete-sink", [
    "pipelines",
    "sinks",
    "delete",
    context.names.sink,
    "--force",
  ]).pipe(Effect.ignore);
  yield* runWrangler(context, "delete-stream", [
    "pipelines",
    "streams",
    "delete",
    context.names.stream,
    "--force",
  ]).pipe(Effect.ignore);
  yield* deleteBucketObjects(context).pipe(
    Effect.catch((error) =>
      writeOutputFile(
        context,
        "delete-objects.log",
        `${redactSecrets(error.message, context.secrets)}\n`,
      ).pipe(Effect.ignore),
    ),
  );
  yield* runWrangler(context, "disable-catalog", [
    "r2",
    "bucket",
    "catalog",
    "disable",
    context.names.bucket,
  ]).pipe(Effect.ignore);
  yield* runWrangler(
    context,
    "delete-bucket",
    ["r2", "bucket", "delete", context.names.bucket],
    {
      input: "y\n",
    },
  ).pipe(Effect.ignore);
});

const deleteBucketObjects = Effect.fn("r2CatalogSmoke.deleteBucketObjects")(
  function* (context) {
    const keys = [];
    let cursor = undefined;
    do {
      const response = yield* callCloudflareApi(
        context,
        `accounts/${context.accountId}/r2/buckets/${context.names.bucket}/objects`,
        {
          label: "list-objects",
          query: { cursor, per_page: "1000" },
        },
      );
      const pageKeys = yield* effectTry(
        "cloudflare-api:list-objects-contract",
        () => {
          if (!Array.isArray(response.result)) {
            throw new Error(
              "Cloudflare object listing omitted its result array.",
            );
          }
          return response.result.map((object) => object.key);
        },
        "Cloudflare object listing returned an invalid response.",
      );
      keys.push(...pageKeys);
      cursor = response.result_info?.cursor;
    } while (cursor);

    yield* writeOutputFile(
      context,
      "delete-object-keys.json",
      `${JSON.stringify(keys, null, 2)}\n`,
    );

    for (let index = 0; index < keys.length; index += 1000) {
      yield* callCloudflareApi(
        context,
        `accounts/${context.accountId}/r2/buckets/${context.names.bucket}/objects`,
        {
          body: keys.slice(index, index + 1000),
          label: `delete-objects-${index / 1000 + 1}`,
          method: "DELETE",
        },
      );
    }
  },
);

const callCloudflareApi = Effect.fn("r2CatalogSmoke.callCloudflareApi")(
  function* (context, apiPath, options = {}) {
    const query = new URLSearchParams(
      Object.entries(options.query ?? {}).filter(
        ([, value]) => value !== undefined,
      ),
    );
    const url = new URL(
      `https://api.cloudflare.com/client/v4/${apiPath.replace(/^\/+/, "")}`,
    );
    url.search = query.toString();
    const response = yield* effectTryPromise(
      `cloudflare-api:${options.label ?? "request"}`,
      (signal) =>
        fetch(url, {
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
          headers: {
            authorization: `Bearer ${context.token}`,
            "content-type": "application/json",
          },
          method: options.method ?? "GET",
          signal,
        }),
      `Cloudflare API ${apiPath} request failed.`,
    );
    const bodyText = yield* effectTryPromise(
      `cloudflare-api:${options.label ?? "request"}:body`,
      () => response.text(),
      `Cloudflare API ${apiPath} response could not be read.`,
    );
    yield* writeOutputFile(
      context,
      `${options.label ?? "cloudflare-api"}.json`,
      `${redactSecrets(bodyText, context.secrets)}\n`,
    );
    const body = yield* effectTry(
      `cloudflare-api:${options.label ?? "request"}:decode`,
      () => JSON.parse(bodyText),
      `Cloudflare API ${apiPath} returned malformed JSON with HTTP ${response.status}`,
    );

    if (!response.ok || body.success === false) {
      return yield* Effect.fail(
        smokeError(
          `cloudflare-api:${options.label ?? "request"}`,
          `Cloudflare API ${apiPath} failed with HTTP ${response.status}: ${cloudflareErrorSummary(body)}`,
        ),
      );
    }

    return body;
  },
);

function runWrangler(context, label, wranglerArgs, options = {}) {
  return runLogged(
    context,
    label,
    ["pnpm", "exec", "wrangler", ...wranglerArgs],
    options,
  );
}

const runLogged = Effect.fn("r2CatalogSmoke.runLogged")(function* (
  context,
  label,
  args,
  options = {},
) {
  const executable = args[0];
  const childArgs = args.slice(1);
  const runner = yield* CatalogSmokeCommandRunner;
  const result = yield* runner.run({
    args: childArgs,
    command: executable,
    env: options.env ?? process.env,
    input: options.input,
    label,
  });
  const output = `${result.stdout}${result.stderr}`;
  const redacted = redactSecrets(
    [
      `$ ${[basename(executable), ...childArgs].join(" ")}`,
      output.trimEnd(),
      "",
    ].join("\n"),
    context.secrets,
  );
  yield* writeOutputFile(context, `${label}.log`, redacted);

  if (result.exitCode !== 0) {
    return yield* Effect.fail(
      smokeError(
        `command:${label}`,
        `${label} failed with exit code ${result.exitCode}. See ${context.outputDir}.`,
      ),
    );
  }

  return output;
});

function parseContext(argv, env) {
  return effectTry(
    "input",
    () => {
      const args = parseArgs(argv);
      const tokenEnv = args["token-env"] ?? DEFAULT_TOKEN_ENV;
      const token = requireToken(env, tokenEnv);
      const accountId = args["account-id"] ?? DEFAULT_ACCOUNT_ID;
      const names = catalogSmokeNames({
        accountId,
        base: args.base,
        bucket: args.bucket,
        namespace: args.namespace,
        suffix: args.suffix,
        table: args.table,
      });
      return {
        args,
        context: {
          accountId,
          cleanup: args.cleanup !== "false",
          names,
          outputDir: join(args["output-dir"] ?? DEFAULT_OUTPUT_DIR, names.base),
          secrets: [token],
          token,
        },
      };
    },
    "Invalid R2 catalog smoke configuration.",
  );
}

export const runCatalogSmoke = Effect.fn("r2CatalogSmoke.run")(function* (
  argv,
  env = process.env,
) {
  const { args, context } = yield* parseContext(argv, env);
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

  yield* Effect.scoped(
    Effect.gen(function* () {
      const resource = yield* Effect.acquireRelease(
        Effect.succeed(context),
        (ownedContext) =>
          ownedContext.cleanup ? cleanup(ownedContext) : Effect.void,
      );
      yield* provision(resource);
      const expectedValue = yield* ingest(resource, args.value);
      yield* verifyQueries(resource, expectedValue);
    }),
  );
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const main = runCatalogSmoke(process.argv.slice(2)).pipe(
    Effect.provide(CatalogSmokeCommandRunnerLive),
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(error.message);
        process.exitCode = 1;
      }),
    ),
  );
  NodeRuntime.runMain(main);
}
