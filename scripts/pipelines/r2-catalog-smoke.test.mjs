import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { Cause, Effect, Exit, Fiber } from "effect";

import {
  aggregateQuery,
  assertAggregateMatches,
  CatalogSmokeCommandRunner,
  CatalogSmokeCommandRunnerLive,
  catalogSmokeNames,
  cloudflareErrorSummary,
  isR2SqlSuccess,
  normalizePipelineNamePart,
  parseWranglerJsonOutput,
  pipelineStatusFrom,
  r2SqlApiUrl,
  r2SqlErrorSummary,
  redactSecrets,
  requireToken,
  sqlStringLiteral,
  streamEndpointFrom,
} from "./r2-catalog-smoke.mjs";

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForPid(pidFile) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const contents = yield* Effect.tryPromise(() =>
        readFile(pidFile, "utf8"),
      ).pipe(Effect.option);
      if (contents._tag === "Some") {
        const pid = Number.parseInt(contents.value, 10);
        if (Number.isSafeInteger(pid) && pid > 0) return pid;
      }
      yield* Effect.sleep(10);
    }
    return yield* Effect.fail(new Error("Command descendant pid unavailable."));
  });
}

function waitForPidExit(pid) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (!pidExists(pid)) return;
      yield* Effect.sleep(10);
    }
    return yield* Effect.fail(
      new Error(`Command descendant ${String(pid)} remained alive.`),
    );
  });
}

function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Effect.succeed({
      exitCode: child.exitCode,
      signal: child.signalCode,
    });
  }
  return Effect.callback((resume) => {
    const onError = (cause) => resume(Effect.fail(cause));
    const onExit = (exitCode, signal) =>
      resume(Effect.succeed({ exitCode, signal }));
    child.once("error", onError);
    child.once("exit", onExit);
    return Effect.sync(() => {
      child.off("error", onError);
      child.off("exit", onExit);
    });
  });
}

test("normalizePipelineNamePart keeps Cloudflare Pipeline-safe names", () => {
  assert.equal(
    normalizePipelineNamePart("Sketchi R2 SQL Fresh 2026-06-28"),
    "sketchi_r2_sql_fresh_2026_06_28",
  );
});

test("normalizePipelineNamePart rejects empty names", () => {
  assert.throws(() => normalizePipelineNamePart("---"), /Invalid Pipeline/);
});

test("catalogSmokeNames derives consistent bucket and pipeline names", () => {
  assert.deepEqual(
    catalogSmokeNames({
      accountId: "abc123",
      suffix: "20260628233000",
    }),
    {
      base: "sketchi_r2sql_20260628233000",
      bucket: "sketchi-r2sql-20260628233000",
      namespace: "smoke",
      pipeline: "sketchi_r2sql_20260628233000_pipeline",
      sink: "sketchi_r2sql_20260628233000_sink",
      stream: "sketchi_r2sql_20260628233000_stream",
      table: "events",
      warehouse: "abc123_sketchi-r2sql-20260628233000",
    },
  );
});

test("catalogSmokeNames rejects invalid explicit bucket names", () => {
  assert.throws(
    () => catalogSmokeNames({ bucket: "Not_A_Bucket", suffix: "ok" }),
    /Invalid R2 bucket/,
  );
});

test("sqlStringLiteral escapes single quotes", () => {
  assert.equal(sqlStringLiteral("row's value"), "'row''s value'");
});

test("aggregateQuery filters to the ingested value", () => {
  assert.equal(
    aggregateQuery(
      { namespace: "sketchi_codemode", table: "usage_events" },
      "row's value",
    ),
    [
      "SELECT",
      "  COUNT(*) AS total_rows,",
      "  MIN(value) AS min_value,",
      "  MAX(value) AS max_value",
      "FROM sketchi_codemode.usage_events",
      "WHERE value = 'row''s value'",
    ].join("\n"),
  );
});

test("r2SqlApiUrl targets the direct R2 SQL endpoint", () => {
  assert.equal(
    r2SqlApiUrl("account-id", "bucket-name"),
    "https://api.sql.cloudflarestorage.com/api/v1/accounts/account-id/r2-sql/query/bucket-name",
  );
});

test("isR2SqlSuccess only accepts explicit successful query responses", () => {
  assert.equal(isR2SqlSuccess({ success: true }), true);
  assert.equal(isR2SqlSuccess({ success: false }), false);
  assert.equal(isR2SqlSuccess({}), false);
});

test("r2SqlErrorSummary preserves R2 SQL error code and message", () => {
  assert.equal(
    r2SqlErrorSummary({
      errors: [{ code: 50408, message: "Corrupted Catalog" }],
    }),
    "50408: Corrupted Catalog",
  );
});

test("cloudflareErrorSummary preserves Cloudflare API error code and message", () => {
  assert.equal(
    cloudflareErrorSummary({
      errors: [
        { code: 9109, message: "Unauthorized to access requested resource" },
      ],
    }),
    "9109: Unauthorized to access requested resource",
  );
});

test("redactSecrets removes token values from logs", () => {
  assert.equal(
    redactSecrets("wrangler --catalog-token secret-token", ["secret-token"]),
    "wrangler --catalog-token [redacted]",
  );
});

test("streamEndpointFrom extracts the HTTP ingest endpoint", () => {
  assert.equal(
    streamEndpointFrom(
      "Endpoint:        https://b6755dc0c97f4fc4b088f53fd9ab5a4d.ingest.cloudflare.com",
    ),
    "https://b6755dc0c97f4fc4b088f53fd9ab5a4d.ingest.cloudflare.com",
  );
});

test("requireToken explains the credential boundary", () => {
  assert.throws(
    () => requireToken({}, "WRANGLER_R2_SQL_AUTH_TOKEN"),
    /Wrangler OAuth tokens can list catalog metadata/,
  );
});

test("requireToken returns the configured token", () => {
  assert.equal(
    requireToken({ WRANGLER_R2_SQL_AUTH_TOKEN: "  token-value  " }),
    "token-value",
  );
});

test("parseWranglerJsonOutput extracts JSON from wrangler output", () => {
  assert.deepEqual(
    parseWranglerJsonOutput(
      [
        "wrangler pipelines get example --json",
        '{ "result": { "status": "running" } }',
        "warning: beta command",
      ].join("\n"),
    ),
    { result: { status: "running" } },
  );
});

test("pipelineStatusFrom normalizes details responses", () => {
  assert.equal(
    pipelineStatusFrom({ result: { status: "Running" } }),
    "running",
  );
  assert.equal(pipelineStatusFrom({ status: "ACTIVE" }), "active");
});

test("assertAggregateMatches accepts the ingested row", () => {
  assert.doesNotThrow(() =>
    assertAggregateMatches(
      {
        result: {
          rows: [
            { total_rows: 1, min_value: "expected", max_value: "expected" },
          ],
        },
      },
      "expected",
    ),
  );
});

test("assertAggregateMatches rejects metadata-only tables", () => {
  assert.throws(
    () =>
      assertAggregateMatches(
        {
          result: {
            rows: [{ total_rows: 0, min_value: null, max_value: null }],
          },
        },
        "expected",
      ),
    /did not return the ingested value/,
  );
});

test(
  "scoped command interruption terminates the Wrangler process tree",
  { skip: process.platform === "win32" },
  () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.tryPromise(() => mkdir(".memory", { recursive: true }));
          const fixtureDir = yield* Effect.acquireRelease(
            Effect.tryPromise(() =>
              mkdtemp(join(".memory", "r2-catalog-command-")),
            ),
            (directory) =>
              Effect.tryPromise(() =>
                rm(directory, { recursive: true, force: true }),
              ).pipe(Effect.ignore),
          );
          const pidFile = join(fixtureDir, "descendant.pid");
          const descendantScript = [
            "process.on('SIGTERM', () => {});",
            "setInterval(() => {}, 1000);",
          ].join("");
          const parentScript = [
            "const { spawn } = require('node:child_process');",
            "const { writeFileSync } = require('node:fs');",
            `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' });`,
            `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
            "setInterval(() => {}, 1000);",
          ].join("");
          const runner = yield* CatalogSmokeCommandRunner;
          const commandFiber = yield* runner
            .run({
              args: ["-e", parentScript],
              command: process.execPath,
              env: process.env,
              label: "interruption-test",
            })
            .pipe(Effect.forkChild);
          const descendantPid = yield* waitForPid(pidFile);
          yield* Fiber.interrupt(commandFiber);
          const commandExit = yield* Fiber.await(commandFiber);

          assert.equal(Exit.isFailure(commandExit), true);
          if (Exit.isFailure(commandExit)) {
            assert.equal(Cause.hasInterrupts(commandExit.cause), true);
          }
          yield* waitForPidExit(descendantPid);
          assert.equal(pidExists(descendantPid), false);
        }),
      ).pipe(Effect.provide(CatalogSmokeCommandRunnerLive)),
    ),
);

test(
  "SIGTERM interrupts the main fiber, terminates descendants, and runs cleanup",
  { skip: process.platform === "win32" },
  () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.tryPromise(() => mkdir(".memory", { recursive: true }));
          const fixtureDir = yield* Effect.acquireRelease(
            Effect.tryPromise(() =>
              mkdtemp(join(".memory", "r2-catalog-signal-")),
            ),
            (directory) =>
              Effect.tryPromise(() =>
                rm(directory, { recursive: true, force: true }),
              ).pipe(Effect.ignore),
          );
          const cleanupFile = join(fixtureDir, "cleanup.complete");
          const pidFile = join(fixtureDir, "descendant.pid");
          const descendantScript = [
            "process.on('SIGTERM', () => {});",
            "setInterval(() => {}, 1000);",
          ].join("");
          const parentScript = [
            "const { spawn } = require('node:child_process');",
            "const { writeFileSync } = require('node:fs');",
            `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' });`,
            `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
            "setInterval(() => {}, 1000);",
          ].join("");
          const moduleUrl = pathToFileURL(
            join(process.cwd(), "scripts/pipelines/r2-catalog-smoke.mjs"),
          ).href;
          const entryScript = [
            "import { writeFile } from 'node:fs/promises';",
            "import { NodeRuntime } from '@effect/platform-node';",
            "import { Effect } from 'effect';",
            `import { CatalogSmokeCommandRunner, CatalogSmokeCommandRunnerLive } from ${JSON.stringify(moduleUrl)};`,
            "const main = Effect.scoped(Effect.gen(function* () {",
            `  yield* Effect.acquireRelease(Effect.void, () => Effect.tryPromise(() => writeFile(${JSON.stringify(cleanupFile)}, 'complete')));`,
            "  const runner = yield* CatalogSmokeCommandRunner;",
            `  yield* runner.run({ command: process.execPath, args: ['-e', ${JSON.stringify(parentScript)}], env: process.env, label: 'signal-test' });`,
            "})).pipe(Effect.provide(CatalogSmokeCommandRunnerLive));",
            "NodeRuntime.runMain(main);",
          ].join("\n");
          const entryProcess = yield* Effect.acquireRelease(
            Effect.sync(() =>
              spawn(
                process.execPath,
                ["--input-type=module", "-e", entryScript],
                {
                  stdio: "ignore",
                },
              ),
            ),
            (child) =>
              Effect.sync(() => {
                if (child.exitCode === null && child.signalCode === null) {
                  child.kill("SIGKILL");
                }
              }),
          );
          const descendantPid = yield* waitForPid(pidFile);
          assert.equal(entryProcess.kill("SIGTERM"), true);
          const entryExit = yield* waitForChildExit(entryProcess);

          assert.notEqual(entryExit.exitCode, 0);
          yield* waitForPidExit(descendantPid);
          yield* Effect.tryPromise(() => access(cleanupFile));
          assert.equal(pidExists(descendantPid), false);
        }),
      ),
    ),
);
