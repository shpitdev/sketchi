// The checked-in DuckDB init and views, run by the real DuckDB CLI on local rows and a local
// Iceberg REST catalog.
import { execFile, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";

import { expect, test } from "vitest";

import { duckdbCommand, VIEWS_SQL } from "../src/telemetry/db";

const views = readFileSync(VIEWS_SQL, "utf8");
const duckdb = spawnSync("duckdb", ["--version"], { encoding: "utf8" });
const pinnedDuckdb = readFileSync(new URL("../../../mise.toml", import.meta.url), "utf8").match(
	/^duckdb = "([\d.]+)"$/m,
)?.[1];
const CATALOG_HOST = "https://catalog.cloudflarestorage.com";
const ACCOUNT = "test-account";
const SPAN_COLUMNS = [
	...["schema", "trace_id", "span_id", "parent_span_id", "name", "kind", "service"],
	...["environment", "service_version", "start_time", "end_time", "duration_ms", "outcome"],
	...["error_tag", "error_message", "error", "cause", "attributes", "events", "ray_id"],
	...["run_id", "attempt_id", "part_index", "part_count", "__ingest_ts"],
];
const columnType = (name: string) =>
	name.endsWith("_time") || name === "__ingest_ts"
		? "timestamp"
		: name === "duration_ms"
			? "double"
			: name.startsWith("part_")
				? "int"
				: "string";

/** An Iceberg REST catalog on localhost whose every `observability.spans` table is empty. */
async function emptySpanCatalog() {
	const requests: { path: string; warehouse: string | null; authorization: string | undefined }[] =
		[];
	const metadata = {
		"format-version": 2,
		"table-uuid": "00000000-0000-4000-8000-000000000000",
		location: "file:///nonexistent/spans",
		"last-sequence-number": 0,
		"last-updated-ms": 0,
		"last-column-id": SPAN_COLUMNS.length,
		"current-schema-id": 0,
		schemas: [
			{
				type: "struct",
				"schema-id": 0,
				fields: SPAN_COLUMNS.map((name, index) => ({
					id: index + 1,
					name,
					required: false,
					type: columnType(name),
				})),
			},
		],
		"default-spec-id": 0,
		"partition-specs": [{ "spec-id": 0, fields: [] }],
		"last-partition-id": 999,
		"default-sort-order-id": 0,
		"sort-orders": [{ "order-id": 0, fields: [] }],
		properties: {},
		snapshots: [],
		"snapshot-log": [],
		"metadata-log": [],
	};
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://catalog");
		requests.push({
			path: url.pathname,
			warehouse: url.searchParams.get("warehouse"),
			authorization: request.headers.authorization,
		});
		response.setHeader("content-type", "application/json");
		if (url.pathname.endsWith("/v1/config")) {
			response.end(JSON.stringify({ defaults: {}, overrides: {} }));
		} else if (url.pathname.endsWith("/v1/namespaces/observability/tables/spans")) {
			response.end(
				JSON.stringify({ "metadata-location": `${metadata.location}/v1.json`, metadata }),
			);
		} else {
			response.statusCode = 404;
			response.end(JSON.stringify({ error: { code: 404, message: "absent", type: "NotFound" } }));
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		endpoint: `http://127.0.0.1:${port}`,
		requests,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

test.skipIf(duckdb.status !== 0).each(["preview", "production"] as const)(
	"pnpm db opens the %s span catalog and the production usage history with the token",
	async (environment) => {
		// R2's span manifests need the pinned release: 1.5.2's iceberg extension aborts on them.
		expect(duckdb.stdout, "run with the mise.toml DuckDB").toMatch(
			new RegExp(`^v${pinnedDuckdb} `),
		);
		const catalog = await emptySpanCatalog();
		try {
			const sql = "SELECT getvariable('telemetry_env') AS env, (FROM spans SELECT count(*)) AS n";
			const flags = environment === "preview" ? ["--preview"] : [];
			const command = duckdbCommand([...flags, "-noheader", "-list", "-c", sql], ACCOUNT);
			const { stdout } = await promisify(execFile)(
				command.command,
				command.args.map((arg) => arg.replaceAll(CATALOG_HOST, catalog.endpoint)),
				{ env: { ...process.env, ...command.env, R2_DATA_READ_TOKEN: "test-token", AI_AGENT: "" } },
			);
			expect(stdout.trim().split("\n").at(-1)).toBe(`${environment}|0`);
			const bucket = `sketchi-telemetry-${environment}`;
			const history = "sketchi-codemode-usage-analytics-production-v4";
			// Only the selected span catalog opens, beside the production usage history.
			expect(
				new Set(
					catalog.requests
						.filter(({ path }) => path.endsWith("/v1/config"))
						.map(({ path, warehouse }) => `${path}?warehouse=${warehouse}`),
				),
			).toEqual(
				new Set([
					`/${ACCOUNT}/${bucket}/v1/config?warehouse=${ACCOUNT}_${bucket}`,
					`/${ACCOUNT}/${history}/v1/config?warehouse=${ACCOUNT}_${history}`,
				]),
			);
			expect(
				new Set(
					catalog.requests.filter(({ path }) => path.includes("/tables/")).map(({ path }) => path),
				),
			).toEqual(new Set([`/${ACCOUNT}/${bucket}/v1/namespaces/observability/tables/spans`]));
			expect(
				catalog.requests.every(({ authorization }) => authorization === "Bearer test-token"),
			).toBe(true);
		} finally {
			await catalog.close();
		}
	},
);

/** A marked section of the checked-in views, reading a local table instead of the catalog. */
function section(name: string) {
	const start = views.indexOf(`-- begin: ${name}`);
	const end = views.indexOf(`-- end: ${name}`);
	expect(start >= 0 && end > start, `duckdb-views.sql marks its ${name}`).toBe(true);
	return views.slice(start, end).replaceAll("telemetry.observability.spans", "raw_spans");
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
	spanId: string,
	partIndex: number,
	partCount: number,
	attributes: string,
	events: string,
	ingested = "2026-11-07 00:00:01",
	name = `span.${spanId}`,
) {
	return `('sketchi.telemetry.span.v1', 'trace', '${spanId}', NULL, '${name}', 'internal',
		'sketchi-test', NULL, NULL, '2026-11-07 00:00:00', '2026-11-07 00:00:01', 1.0, 'success',
		NULL, NULL, NULL, NULL, '${attributes}', '${events}', 'ray', 'run_1', 'attempt_1', ${partIndex}, ${partCount},
		'${ingested}')`;
}

function query(sql: string): unknown {
	const result = spawnSync("duckdb", ["-noheader", "-list", "-c", sql], {
		encoding: "utf8",
		env: { ...process.env, AI_AGENT: "" },
	});
	expect(result.status, result.stderr).toBe(0);
	return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "");
}

test.skipIf(duckdb.status !== 0)(
	"joins a split span only once every part has arrived, and lists the rest",
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
		expect(query(sql)).toEqual({
			incomplete: [{ count: 2, id: "partial", parts: [0], received: 1 }],
			spans: [
				{ a: "split", id: "split" },
				{ a: "whole", id: "whole" },
			],
		});
	},
);

test.skipIf(duckdb.status !== 0)(
	"reads Code Mode usage and its issues from capture spans that record a usage summary",
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
		expect(query(sql)).toEqual({
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
