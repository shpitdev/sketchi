-- `pnpm db` runs this before attaching the span and Code Mode history catalogs
-- and loading duckdb-views.sql. See docs/architecture.md, "Persistence and telemetry".
INSTALL iceberg;
LOAD iceberg;

CREATE OR REPLACE SECRET r2_data_read (TYPE ICEBERG, TOKEN getenv('R2_DATA_READ_TOKEN'));

SET VARIABLE telemetry_env = coalesce(nullif(getenv('TELEMETRY_ENV'), ''), 'production');
