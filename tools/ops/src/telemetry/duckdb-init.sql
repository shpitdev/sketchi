-- Sketchi spans, read from R2 Data Catalog (Iceberg), and the Code Mode usage views
-- over them. `pnpm db` runs this with R2_DATA_READ_TOKEN set, then attaches the selected
-- span catalog as `telemetry` and reads duckdb-views.sql; `pnpm db --preview` selects the
-- preview catalog. See docs/architecture.md, "Persistence and telemetry".
INSTALL iceberg;
LOAD iceberg;

CREATE OR REPLACE SECRET r2_data_read (TYPE ICEBERG, TOKEN getenv('R2_DATA_READ_TOKEN'));

SET VARIABLE telemetry_env = coalesce(nullif(getenv('TELEMETRY_ENV'), ''), 'production');

-- Production Code Mode usage rows written before usage moved into spans, kept as they
-- were: codemode_history.sketchi_codemode.usage_events and .usage_issues.
ATTACH '75f9660f39e4dafe8b95980b87e7399a_sketchi-codemode-usage-analytics-production-v4' AS codemode_history (
	TYPE ICEBERG,
	ENDPOINT 'https://catalog.cloudflarestorage.com/75f9660f39e4dafe8b95980b87e7399a/sketchi-codemode-usage-analytics-production-v4',
	SECRET r2_data_read,
	READ_ONLY
);
