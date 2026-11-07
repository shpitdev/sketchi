import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const init = readFileSync(new URL("./duckdb-init.sql", import.meta.url), "utf8");
const duckdb = spawnSync("duckdb", ["--version"], { encoding: "utf8" });

/** The checked-in reassembly views, reading a local table instead of the catalog. */
function reassemblySql() {
	const start = init.indexOf("-- begin: span reassembly");
	const end = init.indexOf("-- end: span reassembly");
	assert.ok(start >= 0 && end > start, "duckdb-init.sql marks its span reassembly views");
	return init.slice(start, end).replaceAll("telemetry.observability.spans", "raw_spans");
}

// A split span's events text sits in one of its parts, as spanRows writes it.
function row(spanId, partIndex, partCount, attributes, events, ingested = "2026-11-07 00:00:01") {
	return `('sketchi.telemetry.span.v1', 'trace', '${spanId}', NULL, 'span.${spanId}', 'internal',
		'sketchi-test', NULL, NULL, '2026-11-07 00:00:00', '2026-11-07 00:00:01', 1.0, 'success',
		NULL, NULL, NULL, NULL, '${attributes}', '${events}', NULL, NULL, NULL, ${partIndex}, ${partCount},
		'${ingested}')`;
}

test(
	"joins a split span only once every part has arrived, and lists the rest",
	{ skip: duckdb.status === 0 ? false : "the DuckDB CLI is not installed" },
	() => {
		const sql = `
CREATE TABLE raw_spans (
	schema VARCHAR, trace_id VARCHAR, span_id VARCHAR, parent_span_id VARCHAR, name VARCHAR,
	kind VARCHAR, service VARCHAR, environment VARCHAR, service_version VARCHAR,
	start_time TIMESTAMP, end_time TIMESTAMP, duration_ms DOUBLE, outcome VARCHAR,
	error_tag VARCHAR, error_message VARCHAR, error VARCHAR, cause VARCHAR, attributes VARCHAR,
	events VARCHAR, ray_id VARCHAR, run_id VARCHAR, attempt_id VARCHAR, part_index INTEGER,
	part_count INTEGER, __ingest_ts TIMESTAMP
);
INSERT INTO raw_spans VALUES
	${row("whole", 0, 1, '{"a":"whole"}', "[]")},
	${row("split", 0, 2, '{"a":"sp', "")},
	${row("split", 1, 2, 'lit"}', "[]")},
	${row("split", 1, 2, 'lit"}', "[]", "2026-11-07 00:00:09")},
	${row("partial", 0, 2, '{"a":"part', "")};
${reassemblySql()}
SELECT to_json({
	spans: (SELECT list({id: span_id, a: attributes->>'a'} ORDER BY span_id) FROM spans),
	incomplete: (
		SELECT list({id: span_id, received: parts_received, count: part_count, parts: parts})
		FROM incomplete_spans
	)
}) AS result;
`;
		const result = spawnSync("duckdb", ["-noheader", "-list", "-c", sql], {
			encoding: "utf8",
			env: { ...process.env, AI_AGENT: "" },
		});
		assert.equal(result.status, 0, result.stderr);
		const lines = result.stdout.trim().split("\n");
		assert.deepEqual(JSON.parse(lines.at(-1) ?? ""), {
			incomplete: [{ count: 2, id: "partial", parts: [0], received: 1 }],
			spans: [
				{ a: "split", id: "split" },
				{ a: "whole", id: "whole" },
			],
		});
	},
);
