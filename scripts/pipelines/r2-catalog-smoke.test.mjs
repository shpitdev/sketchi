import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateQuery,
  assertAggregateMatches,
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
    parseWranglerJsonOutput([
      "wrangler pipelines get example --json",
      '{ "result": { "status": "running" } }',
      "warning: beta command",
    ].join("\n")),
    { result: { status: "running" } },
  );
});

test("pipelineStatusFrom normalizes details responses", () => {
  assert.equal(pipelineStatusFrom({ result: { status: "Running" } }), "running");
  assert.equal(pipelineStatusFrom({ status: "ACTIVE" }), "active");
});

test("assertAggregateMatches accepts the ingested row", () => {
  assert.doesNotThrow(() =>
    assertAggregateMatches(
      {
        result: {
          rows: [{ total_rows: 1, min_value: "expected", max_value: "expected" }],
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
