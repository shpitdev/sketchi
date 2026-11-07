import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const init = readFileSync(new URL("./duckdb-init.sql", import.meta.url), "utf8");
const duckdb = spawnSync("duckdb", ["--version"], { encoding: "utf8" });

/** A marked section of the checked-in views, reading a local table instead of the catalog. */
function section(name) {
	const start = init.indexOf(`-- begin: ${name}`);
	const end = init.indexOf(`-- end: ${name}`);
	assert.ok(start >= 0 && end > start, `duckdb-init.sql marks its ${name}`);
	return init.slice(start, end).replaceAll("telemetry.observability.spans", "raw_spans");
}

const RAW_SPANS = `
CREATE TABLE raw_spans (
	schema VARCHAR, trace_id VARCHAR, span_id VARCHAR, parent_span_id VARCHAR, name VARCHAR,
	kind VARCHAR, service VARCHAR, environment VARCHAR, service_version VARCHAR,
	start_time TIMESTAMP, end_time TIMESTAMP, duration_ms DOUBLE, outcome VARCHAR,
	error_tag VARCHAR, error_message VARCHAR, error VARCHAR, cause VARCHAR, attributes VARCHAR,
	events VARCHAR, ray_id VARCHAR, run_id VARCHAR, attempt_id VARCHAR, part_index INTEGER,
	part_count INTEGER, __ingest_ts TIMESTAMP
);`;

// A split span's events text sits in one of its parts, as spanRows writes it.
function row(
	spanId,
	partIndex,
	partCount,
	attributes,
	events,
	ingested = "2026-11-07 00:00:01",
	name = `span.${spanId}`,
) {
	return `('sketchi.telemetry.span.v1', 'trace', '${spanId}', NULL, '${name}', 'internal',
		'sketchi-test', NULL, NULL, '2026-11-07 00:00:00', '2026-11-07 00:00:01', 1.0, 'success',
		NULL, NULL, NULL, NULL, '${attributes}', '${events}', 'ray', 'run_1', 'attempt_1', ${partIndex}, ${partCount},
		'${ingested}')`;
}

function query(sql) {
	const result = spawnSync("duckdb", ["-noheader", "-list", "-c", sql], {
		encoding: "utf8",
		env: { ...process.env, AI_AGENT: "" },
	});
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "");
}

test(
	"joins a split span only once every part has arrived, and lists the rest",
	{ skip: duckdb.status === 0 ? false : "the DuckDB CLI is not installed" },
	() => {
		const sql = `
${RAW_SPANS}
INSERT INTO raw_spans VALUES
	${row("whole", 0, 1, '{"a":"whole"}', "[]")},
	${row("split", 0, 2, '{"a":"sp', "")},
	${row("split", 1, 2, 'lit"}', "[]")},
	${row("split", 1, 2, 'lit"}', "[]", "2026-11-07 00:00:09")},
	${row("partial", 0, 2, '{"a":"part', "")};
${section("span reassembly")}
SELECT to_json({
	spans: (SELECT list({id: span_id, a: attributes->>'a'} ORDER BY span_id) FROM spans),
	incomplete: (
		SELECT list({id: span_id, received: parts_received, count: part_count, parts: parts})
		FROM incomplete_spans
	)
}) AS result;
`;
		assert.deepEqual(query(sql), {
			incomplete: [{ count: 2, id: "partial", parts: [0], received: 1 }],
			spans: [
				{ a: "split", id: "split" },
				{ a: "whole", id: "whole" },
			],
		});
	},
);

test(
	"reads Code Mode usage and its issues from capture spans that record a usage summary",
	{ skip: duckdb.status === 0 ? false : "the DuckDB CLI is not installed" },
	() => {
		const capture = JSON.stringify({
			"sketchi.input": { spec: {} },
			"sketchi.output": { ok: false },
			"sketchi.usage.event": {
				artifact_count: 0,
				artifact_delivery: false,
				artifacts: [],
				attempt_id: "attempt_1",
				duration_ms: 7,
				error_message: "Node missing",
				event_id: "event_1",
				issue_codes: "invalid_node",
				issue_count: 2,
				operation: "buildFlowchart",
				request_method: "POST",
				request_path: "/api/v1/flowcharts/build",
				run_id: "run_1",
				status: "error",
				status_code: 400,
				surface: "api",
			},
			"sketchi.usage.issues": [
				{ code: "invalid_node", message: "Node missing", path: "response.issues[0]" },
				{ code: "invalid_node", path: "response.issues[1]", severity: "error" },
			],
		});
		// A capture span as #690 wrote it, before the usage summary moved onto it.
		const earlierCapture = JSON.stringify({
			operation: "buildFlowchart",
			"sketchi.attempt_id": "attempt_0",
			"sketchi.run_id": "run_0",
			"sketchi.usage.issues": [{ code: "stray", path: "response.issues[0]" }],
			surface: "api",
		});
		const sql = `
${RAW_SPANS}
INSERT INTO raw_spans VALUES
	${row("capture", 0, 1, capture, "[]", undefined, "playground.codeModeUsage.capture")},
	${row("earlier", 0, 1, earlierCapture, "[]", undefined, "playground.codeModeUsage.capture")},
	${row("other", 0, 1, "{}", "[]")};
${section("span reassembly")}
${section("usage views")}
SELECT to_json({
	events: (SELECT list(struct_pack(
		event_id, run_id, attempt_id, operation, surface, status, status_code, duration_ms,
		issue_count, issue_codes, error_message, request_path, request := request::VARCHAR,
		ray_id, span_id
	)) FROM usage_events),
	issues: (SELECT list(struct_pack(event_id, issue_code, issue_message, issue_path, issue_severity)
		ORDER BY issue_path) FROM usage_issues)
}) AS result;
`;
		assert.deepEqual(query(sql), {
			events: [
				{
					attempt_id: "attempt_1",
					duration_ms: 7,
					error_message: "Node missing",
					event_id: "event_1",
					issue_codes: "invalid_node",
					issue_count: 2,
					operation: "buildFlowchart",
					ray_id: "ray",
					request: '{"spec":{}}',
					request_path: "/api/v1/flowcharts/build",
					run_id: "run_1",
					span_id: "capture",
					status: "error",
					status_code: 400,
					surface: "api",
				},
			],
			issues: [
				{
					event_id: "event_1",
					issue_code: "invalid_node",
					issue_message: "Node missing",
					issue_path: "response.issues[0]",
					issue_severity: null,
				},
				{
					event_id: "event_1",
					issue_code: "invalid_node",
					issue_message: null,
					issue_path: "response.issues[1]",
					issue_severity: "error",
				},
			],
		});
	},
);
