import assert from "node:assert/strict";
import test from "node:test";

import {
  codeModeR2CatalogTargets,
  countQuery,
  detailQuery,
  pipelineSql,
  pollVerificationAttempts,
  targetRequiresRows,
  targetRunId,
  warehouseName,
} from "./codemode-r2-catalog.mjs";

test("codeModeR2CatalogTargets captures the durable production and preview sinks", () => {
  assert.deepEqual(
    codeModeR2CatalogTargets().map((target) => ({
      bucket: target.bucket,
      environment: target.environment,
      kind: target.kind,
      pipeline: target.pipeline,
      sink: target.sink,
      streamName: target.streamName,
      table: target.table,
    })),
    [
      {
        bucket: "sketchi-codemode-usage-analytics-preview-v4",
        environment: "preview",
        kind: "events",
        pipeline: "sketchi_codemode_usage_events_preview_v4_to_r2_catalog",
        sink: "sketchi_codemode_usage_events_preview_v4_r2_catalog_sink",
        streamName: "sketchi_codemode_usage_events_preview",
        table: "usage_events",
      },
      {
        bucket: "sketchi-codemode-usage-analytics-preview-v4",
        environment: "preview",
        kind: "issues",
        pipeline: "sketchi_codemode_usage_issues_preview_v4_to_r2_catalog",
        sink: "sketchi_codemode_usage_issues_preview_v4_r2_catalog_sink",
        streamName: "sketchi_codemode_usage_issues_preview",
        table: "usage_issues",
      },
      {
        bucket: "sketchi-codemode-usage-analytics-production-v4",
        environment: "production",
        kind: "events",
        pipeline: "sketchi_codemode_usage_events_production_v4_to_r2_catalog",
        sink: "sketchi_codemode_usage_events_production_v4_r2_catalog_sink",
        streamName: "sketchi_codemode_usage_events_production",
        table: "usage_events",
      },
      {
        bucket: "sketchi-codemode-usage-analytics-production-v4",
        environment: "production",
        kind: "issues",
        pipeline: "sketchi_codemode_usage_issues_production_v4_to_r2_catalog",
        sink: "sketchi_codemode_usage_issues_production_v4_r2_catalog_sink",
        streamName: "sketchi_codemode_usage_issues_production",
        table: "usage_issues",
      },
    ],
  );
});

test("warehouseName combines account and bucket", () => {
  const [target] = codeModeR2CatalogTargets();
  assert.equal(
    warehouseName("account-id", target),
    "account-id_sketchi-codemode-usage-analytics-preview-v4",
  );
});

test("pipelineSql inserts from the real stream into the durable sink", () => {
  const [target] = codeModeR2CatalogTargets();
  assert.equal(
    pipelineSql(target),
    "INSERT INTO sketchi_codemode_usage_events_preview_v4_r2_catalog_sink SELECT * FROM sketchi_codemode_usage_events_preview",
  );
});

test("countQuery filters by run id", () => {
  const [target] = codeModeR2CatalogTargets();
  assert.equal(
    countQuery(target, "run's id"),
    [
      "SELECT COUNT(*) AS total_rows",
      "FROM sketchi_codemode.usage_events",
      "WHERE run_id = 'run''s id'",
    ].join("\n"),
  );
});

test("detailQuery selects event or issue details", () => {
  const [eventsTarget, issuesTarget] = codeModeR2CatalogTargets();

  assert.equal(
    detailQuery(eventsTarget, "run_1"),
    [
      "SELECT event_time, event_id, run_id, operation, status, status_code, issue_count, request_path, harness, scenario_id",
      "FROM sketchi_codemode.usage_events",
      "WHERE run_id = 'run_1'",
    ].join("\n"),
  );

  assert.equal(
    detailQuery(issuesTarget, "run_1"),
    [
      "SELECT event_time, event_id, run_id, issue_code, issue_path, issue_message",
      "FROM sketchi_codemode.usage_issues",
      "WHERE run_id = 'run_1'",
    ].join("\n"),
  );
});

test("targetRunId chooses the run id for the target environment and kind", () => {
  const [previewEventsTarget, previewIssuesTarget] = codeModeR2CatalogTargets();
  assert.equal(
    targetRunId(previewEventsTarget, {
      preview: "preview-run",
      previewIssues: "preview-issue-run",
      production: "production-run",
    }),
    "preview-run",
  );
  assert.equal(
    targetRunId(previewIssuesTarget, {
      preview: "preview-run",
      previewIssues: "preview-issue-run",
      production: "production-run",
    }),
    "preview-issue-run",
  );
  assert.equal(
    targetRunId(previewIssuesTarget, {
      preview: "preview-run",
      production: "production-run",
    }),
    "preview-run",
  );
});

test("targetRequiresRows keeps issue rows optional unless requested", () => {
  const [eventsTarget, issuesTarget] = codeModeR2CatalogTargets();

  assert.equal(targetRequiresRows(eventsTarget, {}), true);
  assert.equal(
    targetRequiresRows(issuesTarget, { preview: "preview-run" }),
    false,
  );
  assert.equal(
    targetRequiresRows(
      issuesTarget,
      { preview: "preview-run" },
      {
        requireIssues: true,
      },
    ),
    true,
  );
  assert.equal(
    targetRequiresRows(issuesTarget, {
      preview: "preview-run",
      previewIssues: "preview-issue-run",
    }),
    true,
  );
});

test("pollVerificationAttempts retries transient R2 SQL query errors", async () => {
  const [target] = codeModeR2CatalogTargets();
  const sleeps = [];
  let calls = 0;

  const result = await pollVerificationAttempts({
    attempts: 3,
    delayMs: 25,
    queryAttempt: async (attempt) => {
      calls += 1;
      if (calls === 1) {
        throw new Error("catalog table is still warming");
      }

      return {
        attempt,
        attempts: 3,
        checkedAt: "2026-06-29T00:00:00.000Z",
        targets: [
          {
            required: true,
            target,
            totalRows: 1,
          },
        ],
      };
    },
    sleepFn: async (delayMs) => {
      sleeps.push(delayMs);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [25]);
});

test("pollVerificationAttempts reports the final query error after retries", async () => {
  const sleeps = [];

  const result = await pollVerificationAttempts({
    attempts: 2,
    delayMs: 25,
    queryAttempt: async () => {
      throw new Error("catalog table is still warming");
    },
    sleepFn: async (delayMs) => {
      sleeps.push(delayMs);
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.message, "catalog table is still warming");
  assert.deepEqual(result.result.targets, []);
  assert.deepEqual(sleeps, [25]);
});
