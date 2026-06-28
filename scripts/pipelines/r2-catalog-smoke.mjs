import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_ACCOUNT_ID = "75f9660f39e4dafe8b95980b87e7399a";
const DEFAULT_NAMESPACE = "smoke";
const DEFAULT_TABLE = "events";
const DEFAULT_TOKEN_ENV = "WRANGLER_R2_SQL_AUTH_TOKEN";
const DEFAULT_OUTPUT_DIR = ".memory/r2-catalog-smoke";
const R2_SQL_API_BASE = "https://api.sql.cloudflarestorage.com/api/v1";
const POLL_ATTEMPTS = 8;
const INITIAL_POLL_DELAY_MS = 65_000;
const POLL_DELAY_MS = 30_000;

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

export function aggregateQuery(names) {
  return [
    "SELECT",
    "  COUNT(*) AS total_rows,",
    "  MIN(value) AS min_value,",
    "  MAX(value) AS max_value",
    `FROM ${names.namespace}.${names.table}`,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tokenEnv = args["token-env"] ?? DEFAULT_TOKEN_ENV;
  const token = requireToken(process.env, tokenEnv);
  const accountId = args["account-id"] ?? DEFAULT_ACCOUNT_ID;
  const names = catalogSmokeNames({
    accountId,
    base: args.base,
    bucket: args.bucket,
    namespace: args.namespace,
    suffix: args.suffix,
    table: args.table,
  });
  const outputDir = join(args["output-dir"] ?? DEFAULT_OUTPUT_DIR, names.base);
  const context = {
    accountId,
    cleanup: args.cleanup !== "false",
    names,
    outputDir,
    secrets: [token],
    token,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, "schema.json"),
    `${JSON.stringify({ fields: [{ name: "value", type: "string", required: true }] })}\n`,
  );

  try {
    await provision(context);
    await ingest(context, args.value);
    await verifyQueries(context);
  } finally {
    if (context.cleanup) {
      await cleanup(context);
    }
  }
}

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

async function provision(context) {
  const schemaFile = join(context.outputDir, "schema.json");

  await runWrangler(context, "create-bucket", [
    "r2",
    "bucket",
    "create",
    context.names.bucket,
  ]);
  await runWrangler(context, "enable-catalog", [
    "r2",
    "bucket",
    "catalog",
    "enable",
    context.names.bucket,
  ]);
  const streamOutput = await runWrangler(context, "create-stream", [
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

  await runWrangler(context, "create-sink", [
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
  await runWrangler(context, "create-pipeline", [
    "pipelines",
    "create",
    context.names.pipeline,
    "--sql",
    `INSERT INTO ${context.names.sink} SELECT * FROM ${context.names.stream}`,
  ]);
}

async function ingest(context, value) {
  const endpoint = context.streamEndpoint;
  if (!endpoint) {
    throw new Error(
      `Could not find HTTP endpoint for stream ${context.names.stream}.`,
    );
  }

  const payloadValue =
    value ?? `r2-catalog-smoke-${new Date().toISOString().replace(/\D/g, "")}`;
  const response = await fetch(endpoint, {
    body: JSON.stringify([{ value: payloadValue }]),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = await response.text();
  await writeFile(join(context.outputDir, "ingest-response.json"), `${body}\n`);
  if (!response.ok) {
    throw new Error(
      `Pipeline ingest failed with HTTP ${response.status}: ${body}`,
    );
  }
}

async function verifyQueries(context) {
  let lastError = null;
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    await delay(attempt === 1 ? INITIAL_POLL_DELAY_MS : POLL_DELAY_MS);
    try {
      await runR2SqlQuery(
        context,
        `show-tables-${attempt}`,
        `SHOW TABLES FROM ${context.names.namespace}`,
      );
      await runR2SqlQuery(
        context,
        `describe-table-${attempt}`,
        `DESCRIBE ${context.names.namespace}.${context.names.table}`,
      );
      await runR2SqlQuery(
        context,
        `aggregate-${attempt}`,
        aggregateQuery(context.names),
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function runR2SqlQuery(context, label, query) {
  const response = await fetch(
    r2SqlApiUrl(context.accountId, context.names.bucket),
    {
      body: JSON.stringify({
        query,
        warehouse: context.names.warehouse,
      }),
      headers: {
        authorization: `Bearer ${context.token}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
  const bodyText = await response.text();
  const redactedBody = redactSecrets(bodyText, context.secrets);
  await writeFile(
    join(context.outputDir, `${label}.json`),
    `${redactedBody}\n`,
  );

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(
      `${label} returned malformed R2 SQL response with HTTP ${response.status}. See ${context.outputDir}.`,
    );
  }

  if (!response.ok || !isR2SqlSuccess(body)) {
    throw new Error(
      `${label} failed with HTTP ${response.status}: ${r2SqlErrorSummary(body)}. See ${context.outputDir}.`,
    );
  }

  return body;
}

async function cleanup(context) {
  await runWrangler(context, "delete-pipeline", [
    "pipelines",
    "delete",
    context.names.pipeline,
    "--force",
  ]).catch(() => undefined);
  await runWrangler(context, "delete-sink", [
    "pipelines",
    "sinks",
    "delete",
    context.names.sink,
    "--force",
  ]).catch(() => undefined);
  await runWrangler(context, "delete-stream", [
    "pipelines",
    "streams",
    "delete",
    context.names.stream,
    "--force",
  ]).catch(() => undefined);
  await deleteBucketObjects(context).catch(async (error) => {
    await writeFile(
      join(context.outputDir, "delete-objects.log"),
      `${redactSecrets(error.message, context.secrets)}\n`,
    );
  });
  await runWrangler(context, "disable-catalog", [
    "r2",
    "bucket",
    "catalog",
    "disable",
    context.names.bucket,
  ]).catch(() => undefined);
  await runWrangler(
    context,
    "delete-bucket",
    ["r2", "bucket", "delete", context.names.bucket],
    {
      input: "y\n",
    },
  ).catch(() => undefined);
}

async function deleteBucketObjects(context) {
  const keys = [];
  let cursor = undefined;
  do {
    const response = await callCloudflareApi(
      context,
      `accounts/${context.accountId}/r2/buckets/${context.names.bucket}/objects`,
      {
        label: "list-objects",
        query: { cursor, per_page: "1000" },
      },
    );
    keys.push(...response.result.map((object) => object.key));
    cursor = response.result_info?.cursor;
  } while (cursor);

  await writeFile(
    join(context.outputDir, "delete-object-keys.json"),
    `${JSON.stringify(keys, null, 2)}\n`,
  );

  for (let index = 0; index < keys.length; index += 1000) {
    await callCloudflareApi(
      context,
      `accounts/${context.accountId}/r2/buckets/${context.names.bucket}/objects`,
      {
        body: keys.slice(index, index + 1000),
        label: `delete-objects-${index / 1000 + 1}`,
        method: "DELETE",
      },
    );
  }
}

async function callCloudflareApi(context, path, options = {}) {
  const query = new URLSearchParams(
    Object.entries(options.query ?? {}).filter(
      ([, value]) => value !== undefined,
    ),
  );
  const url = new URL(
    `https://api.cloudflare.com/client/v4/${path.replace(/^\/+/, "")}`,
  );
  url.search = query.toString();
  const response = await fetch(url, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      authorization: `Bearer ${context.token}`,
      "content-type": "application/json",
    },
    method: options.method ?? "GET",
  });
  const bodyText = await response.text();
  await writeFile(
    join(context.outputDir, `${options.label ?? "cloudflare-api"}.json`),
    `${redactSecrets(bodyText, context.secrets)}\n`,
  );
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(
      `Cloudflare API ${path} returned malformed JSON with HTTP ${response.status}`,
    );
  }

  if (!response.ok || body.success === false) {
    throw new Error(
      `Cloudflare API ${path} failed with HTTP ${response.status}: ${cloudflareErrorSummary(body)}`,
    );
  }

  return body;
}

async function runWrangler(context, label, wranglerArgs, options = {}) {
  return runLogged(
    context,
    label,
    ["pnpm", "exec", "wrangler", ...wranglerArgs],
    options,
  );
}

async function runLogged(context, label, args, options = {}) {
  const executable = args[0];
  const childArgs = args.slice(1);
  const child = spawn(executable, childArgs, {
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (options.input) {
    child.stdin.end(options.input);
  } else {
    child.stdin.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    collect(child.stdout),
    collect(child.stderr),
    new Promise((resolve) => child.on("close", resolve)),
  ]);
  const output = `${stdout}${stderr}`;
  const redacted = redactSecrets(
    [
      `$ ${[basename(executable), ...childArgs].join(" ")}`,
      output.trimEnd(),
      "",
    ].join("\n"),
    context.secrets,
  );
  await writeFile(join(context.outputDir, `${label}.log`), redacted);

  if (exitCode !== 0) {
    throw new Error(
      `${label} failed with exit code ${exitCode}. See ${context.outputDir}.`,
    );
  }

  return output;
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(data));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
