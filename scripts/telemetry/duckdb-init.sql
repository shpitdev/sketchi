-- Sketchi spans and Code Mode usage, read from R2 Data Catalog (Iceberg).
-- `pnpm db` runs this with R2_DATA_READ_TOKEN set; `pnpm db --preview` reads the
-- preview catalogs. See docs/architecture.md, "Persistence and telemetry".
INSTALL iceberg;
LOAD iceberg;

CREATE OR REPLACE SECRET r2_data_read (TYPE ICEBERG, TOKEN getenv('R2_DATA_READ_TOKEN'));

SET VARIABLE telemetry_env = coalesce(nullif(getenv('TELEMETRY_ENV'), ''), 'production');
SET VARIABLE account_id = '75f9660f39e4dafe8b95980b87e7399a';
SET VARIABLE spans_bucket = 'sketchi-telemetry-' || getvariable('telemetry_env');
SET VARIABLE usage_bucket = 'sketchi-codemode-usage-analytics-' || getvariable('telemetry_env') || '-v4';

ATTACH getvariable('account_id') || '_' || getvariable('spans_bucket') AS telemetry (
	TYPE ICEBERG,
	URI 'https://catalog.cloudflarestorage.com/' || getvariable('account_id') || '/' || getvariable('spans_bucket'),
	SECRET r2_data_read
);
ATTACH getvariable('account_id') || '_' || getvariable('usage_bucket') AS codemode (
	TYPE ICEBERG,
	URI 'https://catalog.cloudflarestorage.com/' || getvariable('account_id') || '/' || getvariable('usage_bucket'),
	SECRET r2_data_read
);

-- One row per span. A span larger than one stream record arrives as several rows that
-- share its IDs; their attributes, events, error message, error and cause concatenate
-- by part_index. part_count > 1 marks a span that was split.
CREATE OR REPLACE VIEW spans AS
WITH
	whole AS (
		SELECT * FROM telemetry.observability.spans WHERE part_count = 1
	),
	joined AS (
		SELECT
			trace_id,
			span_id,
			any_value(parent_span_id) AS parent_span_id,
			any_value(name) AS name,
			any_value(kind) AS kind,
			any_value(service) AS service,
			any_value(environment) AS environment,
			any_value(service_version) AS service_version,
			any_value(start_time) AS start_time,
			any_value(end_time) AS end_time,
			any_value(duration_ms) AS duration_ms,
			any_value(outcome) AS outcome,
			any_value(error_tag) AS error_tag,
			string_agg(error_message, '' ORDER BY part_index) AS error_message,
			string_agg(error, '' ORDER BY part_index) AS error,
			string_agg(cause, '' ORDER BY part_index) AS cause,
			string_agg(attributes, '' ORDER BY part_index) AS attributes,
			string_agg(events, '' ORDER BY part_index) AS events,
			any_value(ray_id) AS ray_id,
			any_value(run_id) AS run_id,
			any_value(attempt_id) AS attempt_id,
			any_value(part_count) AS part_count,
			max(__ingest_ts) AS __ingest_ts
		FROM telemetry.observability.spans
		WHERE part_count > 1
		GROUP BY trace_id, span_id
	),
	rows AS (
		SELECT * EXCLUDE (part_index, schema) FROM whole
		UNION ALL BY NAME
		SELECT * FROM joined
	)
SELECT
	trace_id,
	span_id,
	parent_span_id,
	name,
	kind,
	service,
	environment,
	service_version,
	start_time,
	end_time,
	duration_ms,
	outcome,
	error_tag,
	error_message,
	error::JSON AS error,
	cause,
	attributes::JSON AS attributes,
	events::JSON AS events,
	ray_id,
	run_id,
	attempt_id,
	part_count,
	__ingest_ts AS ingested_at
FROM rows;

-- Every span of one trace, indented under its parent and in start order. The Workers
-- clock only advances on I/O, so spans that start in the same millisecond are ordered
-- by sketchi.span.start_seq, which counts span starts within one isolate.
-- FROM span_tree('<trace_id>')
CREATE OR REPLACE MACRO span_order(start_time, attributes, span_id) AS
	strftime(start_time, '%Y-%m-%dT%H:%M:%S.%g')
	|| lpad(coalesce(attributes->>'sketchi.span.start_seq', '0'), 15, '0')
	|| span_id;

CREATE OR REPLACE MACRO span_tree(trace) AS TABLE
WITH RECURSIVE
	trace_spans AS MATERIALIZED (
		SELECT * FROM spans WHERE trace_id = trace
	),
	tree AS (
		SELECT
			s.*,
			0 AS depth,
			[span_order(s.start_time, s.attributes, s.span_id)] AS path
		FROM trace_spans s
		WHERE s.parent_span_id IS NULL
			OR s.parent_span_id NOT IN (SELECT span_id FROM trace_spans)
		UNION ALL
		SELECT
			c.*,
			t.depth + 1,
			list_append(t.path, span_order(c.start_time, c.attributes, c.span_id))
		FROM trace_spans c
		JOIN tree t ON c.parent_span_id = t.span_id
	)
SELECT
	repeat('  ', depth) || name AS span,
	round(duration_ms, 1) AS ms,
	outcome,
	error_tag,
	service,
	start_time,
	span_id,
	parent_span_id,
	attributes,
	events
FROM tree
ORDER BY path;

-- One row per diagram generation: what was asked, what came back, what it cost.
CREATE OR REPLACE VIEW generations AS
WITH RECURSIVE
	runs AS MATERIALIZED (
		SELECT * FROM spans WHERE name = 'diagramGeneration.runWithPolicy'
	),
	run_traces AS MATERIALIZED (
		SELECT trace_id, span_id, parent_span_id, name, start_time, duration_ms, outcome, attributes
		FROM spans
		WHERE trace_id IN (SELECT trace_id FROM runs)
	),
	below (run_span_id, trace_id, span_id) AS (
		SELECT span_id, trace_id, span_id FROM runs
		UNION ALL
		SELECT b.run_span_id, s.trace_id, s.span_id
		FROM below b
		JOIN run_traces s ON s.trace_id = b.trace_id AND s.parent_span_id = b.span_id
	),
	work AS (
		SELECT
			b.run_span_id,
			count(*) FILTER (s.name = 'diagramGeneration.gatewayChat.attempt') AS model_calls,
			sum(s.duration_ms) FILTER (s.name = 'diagramGeneration.gatewayChat.attempt') AS model_ms,
			count(*) FILTER (s.name = 'diagramGeneration.gatewayChat.attempt' AND s.outcome <> 'success') AS failed_calls,
			count(*) FILTER (s.name IN ('diagramGeneration.repair', 'diagramGeneration.coverage.repair')) AS repairs,
			-- LanguageModel.generateText repeats each attempt's usage; count the attempt's.
			sum((s.attributes->>'gen_ai.usage.input_tokens')::BIGINT)
				FILTER (s.name = 'diagramGeneration.gatewayChat.attempt') AS input_tokens,
			sum((s.attributes->>'gen_ai.usage.output_tokens')::BIGINT)
				FILTER (s.name = 'diagramGeneration.gatewayChat.attempt') AS output_tokens,
			arg_min(s.attributes->'gen_ai.system_instructions', s.start_time)
				FILTER (s.name = 'diagramGeneration.gatewayChat.attempt') AS system_instructions,
			arg_min(s.attributes->'gen_ai.input.messages', s.start_time)
				FILTER (s.name = 'diagramGeneration.gatewayChat.attempt') AS first_input_messages,
			arg_min(s.attributes->'sketchi.output', s.start_time)
				FILTER (s.name = 'diagramGeneration.coverage.check') AS coverage_issues
		FROM below b
		JOIN run_traces s ON s.trace_id = b.trace_id AND s.span_id = b.span_id
		GROUP BY b.run_span_id
	)
SELECT
	r.start_time,
	r.trace_id,
	r.span_id,
	r.service,
	r.ray_id,
	coalesce(r.run_id, (SELECT max(run_id) FROM spans t WHERE t.trace_id = r.trace_id)) AS run_id,
	r.attributes->'sketchi.input'->>'model' AS model,
	r.attributes->'sketchi.input'->'prompt'->>'request' AS prompt,
	r.attributes->'sketchi.input'->'prompt'->>'requestedType' AS requested_type,
	r.attributes->>'family_route' AS family_route,
	r.attributes->'sketchi.output'->'diagram'->>'type' AS diagram_type,
	r.attributes->'sketchi.output'->>'text' AS output,
	r.attributes->'sketchi.output'->'diagnostics' AS diagnostics,
	r.outcome,
	r.error_tag,
	r.error_message,
	round(r.duration_ms) AS duration_ms,
	w.model_calls,
	w.failed_calls,
	w.repairs,
	round(w.model_ms) AS model_ms,
	w.input_tokens,
	w.output_tokens,
	w.input_tokens + w.output_tokens AS total_tokens,
	w.coverage_issues,
	w.system_instructions,
	w.first_input_messages
FROM runs r
LEFT JOIN work w ON w.run_span_id = r.span_id
ORDER BY r.start_time DESC;

-- The slowest spans of the last seven days, with the trace to open in span_tree.
CREATE OR REPLACE VIEW slowest_spans AS
SELECT name, service, round(duration_ms) AS ms, outcome, error_tag, start_time, trace_id, span_id
FROM spans
WHERE start_time > (now() AT TIME ZONE 'UTC') - INTERVAL 7 DAY
ORDER BY duration_ms DESC
LIMIT 100;

-- Duration by span name over the last seven days.
CREATE OR REPLACE VIEW span_durations AS
SELECT
	name,
	service,
	count(*) AS spans,
	round(median(duration_ms)) AS p50_ms,
	round(quantile_cont(duration_ms, 0.95)) AS p95_ms,
	round(max(duration_ms)) AS max_ms,
	count(*) FILTER (outcome <> 'success') AS not_ok
FROM spans
WHERE start_time > (now() AT TIME ZONE 'UTC') - INTERVAL 7 DAY
GROUP BY ALL
ORDER BY p95_ms DESC;

CREATE OR REPLACE VIEW usage_events AS FROM codemode.sketchi_codemode.usage_events;
CREATE OR REPLACE VIEW usage_issues AS FROM codemode.sketchi_codemode.usage_issues;

SELECT
	getvariable('telemetry_env') AS environment,
	'spans, span_tree(trace_id), generations, slowest_spans, span_durations, usage_events, usage_issues' AS views;
