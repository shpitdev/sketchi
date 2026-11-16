-- Sketchi spans, read from R2 Data Catalog (Iceberg), and the Code Mode usage views
-- over them. `pnpm db` runs this with R2_DATA_READ_TOKEN set; `pnpm db --preview`
-- reads the preview catalog. See docs/architecture.md, "Persistence and telemetry".
INSTALL iceberg;
LOAD iceberg;

CREATE OR REPLACE SECRET r2_data_read (TYPE ICEBERG, TOKEN getenv('R2_DATA_READ_TOKEN'));

SET VARIABLE telemetry_env = coalesce(nullif(getenv('TELEMETRY_ENV'), ''), 'production');
SET VARIABLE account_id = '75f9660f39e4dafe8b95980b87e7399a';
SET VARIABLE spans_bucket = 'sketchi-telemetry-' || getvariable('telemetry_env');

ATTACH getvariable('account_id') || '_' || getvariable('spans_bucket') AS telemetry (
	TYPE ICEBERG,
	URI 'https://catalog.cloudflarestorage.com/' || getvariable('account_id') || '/' || getvariable('spans_bucket'),
	SECRET r2_data_read
);
-- Production Code Mode usage rows written before usage moved into spans, kept as they
-- were: codemode_history.sketchi_codemode.usage_events and .usage_issues.
ATTACH getvariable('account_id') || '_sketchi-codemode-usage-analytics-production-v4' AS codemode_history (
	TYPE ICEBERG,
	URI 'https://catalog.cloudflarestorage.com/' || getvariable('account_id') || '/sketchi-codemode-usage-analytics-production-v4',
	SECRET r2_data_read,
	READ_ONLY
);

-- begin: span reassembly
-- The rows of spans larger than one stream record, each part once even if a batch
-- was delivered twice.
CREATE OR REPLACE VIEW span_parts AS
SELECT DISTINCT ON (trace_id, span_id, part_index) *
FROM telemetry.observability.spans
WHERE part_count > 1
ORDER BY trace_id, span_id, part_index, __ingest_ts;

-- One row per span. A span larger than one stream record arrives as several rows that
-- share its IDs; their attributes, events, error message, error and cause concatenate
-- by part_index. part_count > 1 marks a span that was split. A split span appears once
-- all its parts have arrived; until then it is in incomplete_spans.
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
		FROM span_parts
		GROUP BY trace_id, span_id
		HAVING count(DISTINCT part_index) = any_value(part_count)
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

-- Split spans still missing a part: one whose batch is late, or never arrived.
CREATE OR REPLACE VIEW incomplete_spans AS
SELECT
	trace_id,
	span_id,
	any_value(name) AS name,
	any_value(service) AS service,
	any_value(start_time) AS start_time,
	any_value(part_count) AS part_count,
	count(DISTINCT part_index) AS parts_received,
	list(part_index ORDER BY part_index) AS parts,
	max(__ingest_ts) AS last_ingested_at
FROM span_parts
GROUP BY trace_id, span_id
HAVING count(DISTINCT part_index) < any_value(part_count);
-- end: span reassembly

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
				FILTER (s.name = 'diagramGeneration.coverage.check') AS coverage_issues,
			-- Jev's requests deciding an untyped request's family, before generation.
			count(*) FILTER (s.name = 'diagramGeneration.familyNarrowing.round') AS jev_rounds,
			sum(s.duration_ms) FILTER (s.name = 'diagramGeneration.familyNarrowing.round') AS jev_ms,
			sum((s.attributes->>'gen_ai.usage.input_tokens')::BIGINT)
				FILTER (s.name = 'diagramGeneration.familyNarrowing.round') AS jev_input_tokens
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
	r.attributes->>'family_narrowing' AS family_narrowing,
	r.attributes->>'family_shortlist' AS family_shortlist,
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
	w.jev_rounds,
	round(w.jev_ms) AS jev_ms,
	w.jev_input_tokens,
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

-- begin: usage views
-- One row per Code Mode call (API build, patch, canvas, generate, MCP execute), from the
-- usage summary its playground.codeModeUsage.capture span records, with the full
-- request and response. Capture spans written before the summary moved onto them have
-- none and are left out; their calls are in codemode_history.
CREATE OR REPLACE VIEW usage_events AS
WITH captures AS (
	SELECT *, attributes->'sketchi.usage.event' AS event
	FROM spans
	WHERE name = 'playground.codeModeUsage.capture'
		AND json_exists(attributes, '$."sketchi.usage.event"')
)
SELECT
	event->>'event_id' AS event_id,
	event->>'run_id' AS run_id,
	event->>'attempt_id' AS attempt_id,
	start_time AS event_time,
	start_time::DATE AS event_date,
	event->>'surface' AS surface,
	event->>'operation' AS operation,
	event->>'status' AS status,
	(event->>'status_code')::INTEGER AS status_code,
	(event->>'duration_ms')::BIGINT AS duration_ms,
	event->>'client' AS client,
	event->>'harness' AS harness,
	event->>'model' AS model,
	event->>'reasoning_level' AS reasoning_level,
	event->>'scenario_id' AS scenario_id,
	event->>'user_agent' AS user_agent,
	(event->>'artifact_count')::INTEGER AS artifact_count,
	event->>'artifact_formats' AS artifact_formats,
	(event->>'artifact_delivery')::BOOLEAN AS artifact_delivery,
	event->'artifacts' AS artifacts,
	(event->>'issue_count')::INTEGER AS issue_count,
	event->>'issue_codes' AS issue_codes,
	event->>'error_message' AS error_message,
	event->>'request_path' AS request_path,
	event->>'request_method' AS request_method,
	attributes->'sketchi.input' AS request,
	attributes->'sketchi.output' AS response,
	ray_id,
	trace_id,
	span_id
FROM captures;

-- One row per issue a Code Mode call reported.
CREATE OR REPLACE VIEW usage_issues AS
WITH issues AS (
	SELECT
		*,
		attributes->'sketchi.usage.event' AS event,
		unnest(CAST(attributes->'sketchi.usage.issues' AS JSON[])) AS issue
	FROM spans
	WHERE name = 'playground.codeModeUsage.capture'
		AND json_exists(attributes, '$."sketchi.usage.event"')
)
SELECT
	event->>'event_id' AS event_id,
	event->>'run_id' AS run_id,
	event->>'attempt_id' AS attempt_id,
	start_time AS event_time,
	start_time::DATE AS event_date,
	event->>'surface' AS surface,
	event->>'operation' AS operation,
	event->>'status' AS status,
	issue->>'code' AS issue_code,
	issue->>'message' AS issue_message,
	issue->>'path' AS issue_path,
	issue->>'severity' AS issue_severity,
	issue->>'stage' AS issue_stage,
	ray_id,
	trace_id,
	span_id
FROM issues;
-- end: usage views

SELECT
	getvariable('telemetry_env') AS environment,
	'spans, incomplete_spans, span_tree(trace_id), generations, slowest_spans, span_durations, usage_events, usage_issues' AS views;
