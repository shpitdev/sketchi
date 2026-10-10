import assert from "node:assert/strict";
import test from "node:test";
import { R2SqlQueryError } from "./r2-sql.ts";

import {
	codeModeR2CatalogTargets,
	countQuery,
	detailQuery,
	pipelineSql,
	pollVerificationAttempts,
	targetRequiresRows,
	targetRunId,
	warehouseName,
	runR2SqlQuery,
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
	assert.equal(targetRequiresRows(issuesTarget, { preview: "preview-run" }), false);
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
				throw R2SqlQueryError.make({
					message: "catalog table is still warming",
					retryable: true,
				});
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
			throw R2SqlQueryError.make({
				message: "catalog table is still warming",
				retryable: true,
			});
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

for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
	test(`Code Mode HTTP ${status} is classified before JSON decoding`, async () => {
		const previous = globalThis.fetch;
		const [target] = codeModeR2CatalogTargets();
		let calls = 0;
		globalThis.fetch = async (_url, options) => {
			calls++;
			assert.ok(options.signal instanceof AbortSignal);
			return new Response("<html>error</html>", { status });
		};
		try {
			const result = await pollVerificationAttempts({
				attempts: 3,
				delayMs: 0,
				queryAttempt: (_attempt, signal) =>
					runR2SqlQuery({
						accountId: "offline",
						query: "SELECT 1",
						target,
						token: "offline-token",
						signal,
					}),
				sleepFn: async () => {},
			});
			assert.equal(result.ok, false);
			assert.equal(result.error?.status, status);
			assert.equal(
				result.error?.retryable,
				status === 404 || status === 409 || status === 429 || status >= 500,
			);
			assert.equal(calls, result.error?.retryable ? 3 : 1);
		} finally {
			globalThis.fetch = previous;
		}
	});
}

test("Code Mode does not retry unclassified failures", async () => {
	let calls = 0;
	const result = await pollVerificationAttempts({
		attempts: 3,
		delayMs: 0,
		queryAttempt: async () => {
			calls++;
			throw new Error("permanent configuration failure");
		},
		sleepFn: async () => {},
	});
	assert.equal(calls, 1);
	assert.equal(result.ok, false);
});

test("Code Mode retries network failures but not malformed successful JSON", async () => {
	const previous = globalThis.fetch;
	const [target] = codeModeR2CatalogTargets();
	let calls = 0;
	globalThis.fetch = async () => {
		calls++;
		if (calls === 1) throw new TypeError("offline network failure");
		return new Response("not JSON");
	};
	try {
		const result = await pollVerificationAttempts({
			attempts: 3,
			delayMs: 0,
			queryAttempt: (_attempt, signal) =>
				runR2SqlQuery({
					accountId: "offline",
					query: "SELECT 1",
					target,
					token: "offline-token",
					signal,
				}),
			sleepFn: async () => {},
		});
		assert.equal(calls, 2);
		assert.equal(result.error?.retryable, false);
		assert.match(result.error?.message, /Malformed/);
	} finally {
		globalThis.fetch = previous;
	}
});

test("Code Mode bounds stalled response bodies and aborts each attempt", async () => {
	const previous = globalThis.fetch;
	const [target] = codeModeR2CatalogTargets();
	const keepAlive = setInterval(() => {}, 1000);
	let aborted = 0;
	globalThis.fetch = async (_url, options) =>
		new Response(
			new ReadableStream({
				start(controller) {
					options.signal.addEventListener(
						"abort",
						() => {
							aborted++;
							controller.error(options.signal.reason);
						},
						{ once: true },
					);
				},
			}),
		);
	try {
		const result = await pollVerificationAttempts({
			attempts: 2,
			delayMs: 0,
			attemptTimeoutMs: 10,
			queryAttempt: (_attempt, signal) =>
				runR2SqlQuery({
					accountId: "offline",
					query: "SELECT 1",
					target,
					token: "offline-token",
					signal,
				}),
			sleepFn: async () => {},
		});
		assert.equal(aborted, 2);
		assert.equal(result.error?.retryable, true);
		assert.match(result.error?.message, /timed out/);
	} finally {
		clearInterval(keepAlive);
		globalThis.fetch = previous;
	}
});

test("Code Mode caller interruption aborts the request body without retrying", async () => {
	const previous = globalThis.fetch;
	const [target] = codeModeR2CatalogTargets();
	const controller = new AbortController();
	let calls = 0;
	globalThis.fetch = async (_url, options) => {
		calls++;
		return new Response(
			new ReadableStream({
				start(streamController) {
					options.signal.addEventListener(
						"abort",
						() => streamController.error(options.signal.reason),
						{ once: true },
					);
					queueMicrotask(() => controller.abort(new DOMException("cancelled", "AbortError")));
				},
			}),
		);
	};
	try {
		await assert.rejects(
			pollVerificationAttempts({
				attempts: 3,
				delayMs: 0,
				signal: controller.signal,
				queryAttempt: (_attempt, signal) =>
					runR2SqlQuery({
						accountId: "offline",
						query: "SELECT 1",
						target,
						token: "offline-token",
						signal,
					}),
			}),
			{ name: "AbortError" },
		);
		assert.equal(calls, 1);
	} finally {
		globalThis.fetch = previous;
	}
});

test("Code Mode retries successful queries with required rows not yet visible", async () => {
	const [target] = codeModeR2CatalogTargets();
	let calls = 0;
	const sleeps = [];
	const result = await pollVerificationAttempts({
		attempts: 3,
		delayMs: 25,
		queryAttempt: async () => ({
			targets: [{ required: true, target, totalRows: ++calls === 1 ? 0 : 1 }],
		}),
		sleepFn: async (delayMs) => {
			sleeps.push(delayMs);
		},
	});
	assert.equal(result.ok, true);
	assert.equal(calls, 2);
	assert.deepEqual(sleeps, [25]);
});

for (const [header, expectedDelay, attemptTimeoutMs] of [
	["2", 2000, 5000],
	["600", 500, 500],
	["invalid", 25, 5000],
]) {
	test(`Code Mode HTTP 429 Retry-After ${header} waits ${expectedDelay}ms before retrying`, async () => {
		const previous = globalThis.fetch;
		const [target] = codeModeR2CatalogTargets();
		let calls = 0;
		const delays = [];
		globalThis.fetch = async () => {
			calls++;
			return calls === 1
				? new Response("<html>rate limited</html>", {
						status: 429,
						headers: { "retry-after": header },
					})
				: new Response(JSON.stringify({ success: true }));
		};
		try {
			const result = await pollVerificationAttempts({
				attempts: 2,
				delayMs: 25,
				attemptTimeoutMs,
				queryAttempt: async (_attempt, signal) => {
					await runR2SqlQuery({
						accountId: "offline",
						query: "SELECT 1",
						target,
						token: "offline-token",
						signal,
					});
					return { targets: [{ required: true, target, totalRows: 1 }] };
				},
				sleepFn: async (delayMs) => {
					delays.push(delayMs);
				},
			});
			assert.equal(result.ok, true);
			assert.equal(calls, 2);
			assert.deepEqual(delays, [expectedDelay]);
		} finally {
			globalThis.fetch = previous;
		}
	});
}
