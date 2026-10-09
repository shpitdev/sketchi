import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  isR2SqlSuccess,
  r2SqlApiUrl,
  r2SqlErrorSummary,
  requireToken,
  sqlStringLiteral,
  R2SqlQueryError,
  isTransientHttpStatus,
  retryAfterDelayMs,
  pollRetryDelayMs,
} from "./r2-sql.ts";
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_ACCOUNT_ID = "75f9660f39e4dafe8b95980b87e7399a";
const DEFAULT_NAMESPACE = "sketchi_codemode";
const DEFAULT_TOKEN_ENV = "WRANGLER_R2_SQL_AUTH_TOKEN";
const DEFAULT_OUTPUT_DIR = ".memory/codemode-r2sql-e2e";
const DEFAULT_VERIFY_ATTEMPTS = 6;
const DEFAULT_VERIFY_DELAY_MS = 30_000;

const STREAMS = {
  preview: {
    bucket: "sketchi-codemode-usage-analytics-preview-v4",
    events: {
      streamId: "e9fc3bcd35314fa39fc6a89018207acc",
      streamName: "sketchi_codemode_usage_events_preview",
      table: "usage_events",
    },
    issues: {
      streamId: "d95a1767edf246af8c637c5b9bf5a5c5",
      streamName: "sketchi_codemode_usage_issues_preview",
      table: "usage_issues",
    },
  },
  production: {
    bucket: "sketchi-codemode-usage-analytics-production-v4",
    events: {
      streamId: "d9044253316f4273a60298098f444a62",
      streamName: "sketchi_codemode_usage_events_production",
      table: "usage_events",
    },
    issues: {
      streamId: "f687dab6e7d742c1a76834089e709462",
      streamName: "sketchi_codemode_usage_issues_production",
      table: "usage_issues",
    },
  },
};

export function codeModeR2CatalogTargets() {
  return Object.entries(STREAMS).flatMap(([environment, config]) =>
    ["events", "issues"].map((kind) => {
      const stream = config[kind];
      return {
        bucket: config.bucket,
        environment,
        kind,
        namespace: DEFAULT_NAMESPACE,
        pipeline: `${stream.streamName}_v4_to_r2_catalog`,
        sink: `${stream.streamName}_v4_r2_catalog_sink`,
        streamId: stream.streamId,
        streamName: stream.streamName,
        table: stream.table,
      };
    }),
  );
}

export function warehouseName(accountId, target) {
  return `${accountId}_${target.bucket}`;
}

export function pipelineSql(target) {
  return `INSERT INTO ${target.sink} SELECT * FROM ${target.streamName}`;
}

export function detailQuery(target, runId) {
  const filter = `WHERE run_id = ${sqlStringLiteral(runId)}`;
  if (target.kind === "events") {
    return [
      "SELECT event_time, event_id, run_id, operation, status, status_code, issue_count, request_path, harness, scenario_id",
      `FROM ${target.namespace}.${target.table}`,
      filter,
    ].join("\n");
  }

  return [
    "SELECT event_time, event_id, run_id, issue_code, issue_path, issue_message",
    `FROM ${target.namespace}.${target.table}`,
    filter,
  ].join("\n");
}

export function countQuery(target, runId) {
  return [
    "SELECT COUNT(*) AS total_rows",
    `FROM ${target.namespace}.${target.table}`,
    `WHERE run_id = ${sqlStringLiteral(runId)}`,
  ].join("\n");
}

export function targetRunId(target, runIds) {
  if (target.kind === "issues") {
    return runIds[`${target.environment}Issues`] ?? runIds[target.environment];
  }

  return runIds[target.environment];
}

export function targetRequiresRows(target, runIds, options = {}) {
  if (target.kind === "events") {
    return true;
  }

  return Boolean(
    options.requireIssues || runIds[`${target.environment}Issues`],
  );
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === "resources") {
    const accountId = options["account-id"] ?? DEFAULT_ACCOUNT_ID;
    const resources = codeModeR2CatalogTargets().map((target) => ({
      ...target,
      pipelineSql: pipelineSql(target),
      warehouse: warehouseName(accountId, target),
    }));
    console.log(JSON.stringify({ resources }, null, 2));
    return;
  }

  if (command === "verify-run") {
    await verifyRun(options);
    return;
  }

  throw new Error(
    `Unknown command "${command ?? ""}". Use "resources" or "verify-run".`,
  );
}

function parseArgs(args) {
  const [command, ...rest] = args;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument "${arg}".`);
    }
    const key = arg.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      options[key] = "true";
      continue;
    }
    options[key] = value;
    index += 1;
  }

  return { command, options };
}

async function verifyRun(options) {
  const accountId = options["account-id"] ?? DEFAULT_ACCOUNT_ID;
  const tokenEnv = options["token-env"] ?? DEFAULT_TOKEN_ENV;
  const token = requireToken(process.env, tokenEnv);
  const runIds = {
    preview: options["preview-run-id"],
    previewIssues: options["preview-issue-run-id"],
    production: options["production-run-id"],
    productionIssues: options["production-issue-run-id"],
  };
  const missing = Object.entries(runIds)
    .filter(
      ([environment, runId]) =>
        (environment === "preview" || environment === "production") && !runId,
    )
    .map(([environment]) => `--${environment}-run-id`);
  if (missing.length > 0) {
    throw new Error(`Missing required option(s): ${missing.join(", ")}.`);
  }

  const attempts = parseIntegerOption(
    options.attempts,
    DEFAULT_VERIFY_ATTEMPTS,
    "--attempts",
    { min: 1 },
  );
  const delayMs = parseIntegerOption(
    options["delay-ms"],
    DEFAULT_VERIFY_DELAY_MS,
    "--delay-ms",
    { min: 0 },
  );
  const requireIssues = booleanOption(options["require-issues"]);
  const outputDir = options["output-dir"] ?? DEFAULT_OUTPUT_DIR;

  const verification = await pollVerificationAttempts({
    attempts,
    delayMs,
    queryAttempt: (attempt, signal) =>
      queryTargets({
        accountId,
        attempt,
        attempts,
        requireIssues,
        runIds,
        signal,
        token,
      }),
  });

  await writeVerificationResult(outputDir, verification.result);
  if (verification.ok) {
    console.log(
      JSON.stringify(
        {
          attempts: verification.result.attempt,
          checkedAt: verification.result.checkedAt,
          ok: true,
          rows: verification.result.targets.map(
            ({ required, runId, target, totalRows }) => ({
              environment: target.environment,
              kind: target.kind,
              required,
              runId,
              totalRows,
            }),
          ),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (verification.error) {
    throw new Error(
      `R2 SQL query failed after ${attempts} attempt(s): ${errorMessage(
        verification.error,
      )}`,
    );
  }

  throw new Error(
    `R2 SQL did not return required rows for ${verification.missingRows
      .map(({ target }) => `${target.environment}/${target.kind}`)
      .join(
        ", ",
      )} after ${attempts} attempt(s). Issue rows are optional unless --require-issues or an explicit --*-issue-run-id is set.`,
  );
}

function booleanOption(value) {
  return value === true || value === "true";
}

function parseIntegerOption(value, defaultValue, label, { min }) {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${label} must be an integer >= ${min}.`);
  }

  return parsed;
}

export async function pollVerificationAttempts({
  attempts,
  delayMs,
  queryAttempt,
  sleepFn = sleep,
  attemptTimeoutMs = 30_000,
  signal,
}) {
  let result;
  let missingRows = [];
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const attemptSignal = AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(attemptTimeoutMs),
      ]);
      result = await abortableAttempt(queryAttempt, attempt, attemptSignal);
      missingRows = requiredMissingRows(result);
      lastError = undefined;

      if (missingRows.length === 0) {
        return { ok: true, result };
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      lastError =
        error?.name === "TimeoutError"
          ? R2SqlQueryError.make({
              cause: error,
              message: "Catalog polling attempt timed out.",
              retryable: true,
            })
          : error;
      missingRows = [];
      result = {
        attempt,
        attempts,
        checkedAt: new Date().toISOString(),
        error: errorMessage(error),
        targets: [],
      };
      if (!(lastError instanceof R2SqlQueryError) || !lastError.retryable)
        break;
    }

    if (attempt < attempts) {
      await sleepFn(
        pollRetryDelayMs(lastError, delayMs, attemptTimeoutMs),
        undefined,
        { signal },
      );
    }
  }

  return {
    error: lastError,
    missingRows,
    ok: false,
    result,
  };
}

async function queryTargets({
  accountId,
  attempt,
  attempts,
  requireIssues,
  runIds,
  signal,
  token,
}) {
  const checkedAt = new Date().toISOString();
  const result = {
    attempt,
    attempts,
    checkedAt,
    requireIssues,
    runIds,
    targets: [],
  };

  for (const target of codeModeR2CatalogTargets()) {
    const runId = targetRunId(target, runIds);
    const count = await runR2SqlQuery({
      accountId,
      query: countQuery(target, runId),
      target,
      signal,
      token,
    });
    const details = await runR2SqlQuery({
      accountId,
      query: detailQuery(target, runId),
      target,
      signal,
      token,
    });
    const totalRows = Number(count.result.rows?.[0]?.total_rows ?? 0);
    result.targets.push({
      count,
      details,
      required: targetRequiresRows(target, runIds, { requireIssues }),
      runId,
      target,
      totalRows,
    });
  }

  return result;
}

function requiredMissingRows(result) {
  return result.targets.filter(
    ({ required, totalRows }) => required && totalRows < 1,
  );
}

async function writeVerificationResult(outputDir, result) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, `verify-run-${result.checkedAt.replace(/\D/g, "")}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
}

// Bound even an adapter that does not settle on abort, and always detach listeners.
async function abortableAttempt(queryAttempt, attempt, signal) {
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () =>
      reject(
        signal.reason?.name === "TimeoutError"
          ? R2SqlQueryError.make({
              cause: signal.reason,
              message: "Catalog polling attempt timed out.",
              retryable: true,
            })
          : signal.reason,
      );
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([queryAttempt(attempt, signal), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function runR2SqlQuery({
  accountId,
  query,
  target,
  token,
  signal,
}) {
  let response;
  let bodyText;
  try {
    response = await fetch(r2SqlApiUrl(accountId, target.bucket), {
      body: JSON.stringify({
        query,
        warehouse: warehouseName(accountId, target),
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal,
    });
    // Status is authoritative even when an error body is HTML, not JSON.
    if (!response.ok) {
      await response.body?.cancel();
      const retryAfterMs = retryAfterDelayMs(
        response.headers.get("retry-after"),
        Date.now(),
      );
      throw R2SqlQueryError.make({
        status: response.status,
        message: `${target.environment}/${target.kind} R2 SQL failed with HTTP ${response.status}.`,
        retryable: isTransientHttpStatus(response.status),
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      });
    }
    bodyText = await response.text();
  } catch (cause) {
    if (signal?.aborted) throw signal.reason;
    if (cause instanceof R2SqlQueryError) throw cause;
    throw R2SqlQueryError.make({
      cause,
      message: "R2 SQL request or body read failed.",
      retryable: true,
    });
  }
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (cause) {
    throw R2SqlQueryError.make({
      cause,
      message: "Malformed R2 SQL response.",
      retryable: false,
    });
  }
  if (!isR2SqlSuccess(body)) {
    throw R2SqlQueryError.make({
      message: `${target.environment}/${target.kind} R2 SQL failed: ${r2SqlErrorSummary(body)}.`,
      retryable: false,
    });
  }
  return body;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
