import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	COMPACTION_TARGET_MB,
	listedResources,
	provisionSteps,
	ROLL_INTERVAL_SECONDS,
	SNAPSHOT_MAX_AGE_DAYS,
	SNAPSHOTS_RETAINED,
	telemetryTarget,
	telemetryTargets,
	wrangler,
} from "./catalog.mjs";
import { duckdbCommand } from "./db.mjs";

const studioWrangler = JSON.parse(
	readFileSync(new URL("../../apps/playground/wrangler.jsonc", import.meta.url), "utf8").replace(
		/^\s*\/\/.*$/gm,
		"",
	),
);

test("names each environment's spans resources from one pattern", () => {
	assert.deepEqual(telemetryTarget("preview"), {
		bucket: "sketchi-telemetry-preview",
		catalogUri:
			"https://catalog.cloudflarestorage.com/75f9660f39e4dafe8b95980b87e7399a/sketchi-telemetry-preview",
		environment: "preview",
		namespace: "observability",
		pipeline: "sketchi_telemetry_spans_preview_to_catalog",
		pipelineSql:
			"INSERT INTO sketchi_telemetry_spans_preview_catalog SELECT * FROM sketchi_telemetry_spans_preview",
		sink: "sketchi_telemetry_spans_preview_catalog",
		stream: "sketchi_telemetry_spans_preview",
		table: "spans",
		warehouse: "75f9660f39e4dafe8b95980b87e7399a_sketchi-telemetry-preview",
	});
	assert.deepEqual(
		telemetryTargets().map((target) => target.environment),
		["production", "preview"],
	);
	assert.throws(() => telemetryTarget("staging"), /Unknown environment/);
});

test("provisions the stream from the package's schema and maintains the catalog", () => {
	const steps = provisionSteps(telemetryTarget("production"), "token");
	const args = steps.map((step) => step.args.join(" "));
	assert.ok(args.some((line) => line.includes("observability/spans.schema.json")));
	assert.ok(args.some((line) => line.includes("--http-enabled false")));
	assert.ok(
		args.some((line) =>
			line.includes(
				`compaction enable sketchi-telemetry-production --target-size ${COMPACTION_TARGET_MB}`,
			),
		),
	);
	assert.ok(
		args.some((line) =>
			line.includes(
				`--older-than-days ${SNAPSHOT_MAX_AGE_DAYS} --retain-last ${SNAPSHOTS_RETAINED}`,
			),
		),
	);
	assert.ok(args.some((line) => line.includes(`--roll-interval ${ROLL_INTERVAL_SECONDS}`)));
	assert.ok(
		args.at(-1)?.startsWith("pipelines create sketchi_telemetry_spans_production_to_catalog"),
	);
});

test("reads resource names from JSON and from Node's inspect format", () => {
	const json = '[{"id": "a1", "name": "one"}]';
	const inspected = "[\n  {\n    id: 'b2',\n    name: 'two',\n    version: 1\n  }\n]";
	assert.deepEqual(listedResources(json), [{ id: "a1", name: "one" }]);
	assert.deepEqual(listedResources(inspected), [{ id: "b2", name: "two" }]);
});

test("binds Studio and its previews to separate spans streams", () => {
	const production = studioWrangler.pipelines.find(
		(binding) => binding.binding === "TELEMETRY_SPANS",
	);
	const preview = studioWrangler.previews.pipelines.find(
		(binding) => binding.binding === "TELEMETRY_SPANS",
	);
	assert.ok(production?.stream);
	assert.ok(preview?.stream);
	assert.notEqual(production.stream, preview.stream);
	// Local development binds a local stream instead of production's.
	assert.equal(production.remote, undefined);
});

test("runs DuckDB on the init file, through Infisical only without a token", () => {
	const direct = duckdbCommand(["--preview", "-c", "FROM spans"], { R2_DATA_READ_TOKEN: "t" });
	assert.equal(direct.command, "duckdb");
	assert.equal(direct.env.TELEMETRY_ENV, "preview");
	assert.deepEqual(direct.args.slice(2), ["-c", "FROM spans"]);
	assert.match(direct.args[1], /scripts\/telemetry\/duckdb-init\.sql$/);
	const viaInfisical = duckdbCommand([], {});
	assert.equal(viaInfisical.command, "infisical");
	assert.equal(viaInfisical.env.TELEMETRY_ENV, "production");
	assert.deepEqual(viaInfisical.args.slice(0, 7), [
		"run",
		"--projectId",
		"bb3fe729-e290-4740-84d4-304752f0d719",
		"--env",
		"prod",
		"--silent",
		"--",
	]);
});

test("reports a failed wrangler command without the catalog token", () => {
	const token = "cfut_catalog_admin_secret";
	const withToken = provisionSteps(telemetryTarget("production"), token)
		.map((step) => step.args)
		.filter((stepArgs) => stepArgs.includes(token));
	// Compaction, snapshot expiration and the sink.
	assert.equal(withToken.length, 3);
	for (const args of withToken) {
		const exec = (file, execArgs) => {
			// What execFileSync throws: the whole command line, and the child's stderr.
			const error = new Error(`Command failed: ${file} ${execArgs.join(" ")}`);
			error.status = 1;
			error.stderr = `✘ [ERROR] Request with token ${token} was rejected [code: 10000]\n`;
			throw error;
		};
		assert.throws(
			() => wrangler(args, exec),
			(error) => {
				assert.doesNotMatch(error.message, new RegExp(token));
				assert.match(error.message, /^wrangler (basin|pipelines) /);
				assert.match(error.message, /exit status 1/);
				assert.match(error.message, /Request with token \[redacted\] was rejected/);
				assert.equal(error.cause, undefined);
				return true;
			},
		);
	}
});
