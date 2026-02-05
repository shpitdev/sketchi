# Observability

## Trace Propagation

- Use `x-trace-id` on all `/api/diagrams/*` requests.
- If the header is missing or invalid, the API generates a UUID trace id.
- Responses always include `x-trace-id`.
- Diagram endpoints include `stats.traceId` in JSON responses.

## Structured Logs

### Web (Next/oRPC)

- Logs are JSON to stdout with `service=web` and `component=orpc`.
- Successful requests are sampled via `SENTRY_LOG_SAMPLE_RATE` (default `0.1`).
- Errors always log with full context and `traceId`.

### Convex

- Logs are JSON to stdout with `service=convex`.
- Logs include trace metadata and request hashes (sha256) instead of raw payloads.
- `diagramModifyElements` and `generateIntermediate` emit per-step logs with durations.

## Sentry (Convex)

Enable direct Convex → Sentry logging:

```bash
SENTRY_CONVEX_ENABLED=1
SENTRY_CONVEX_MODE=direct
SENTRY_DSN=...
SENTRY_LOG_SAMPLE_RATE=0.1
```

Fallback proxy (Convex → Next → Sentry):

```bash
SENTRY_CONVEX_ENABLED=1
SENTRY_CONVEX_MODE=proxy
SKETCHI_TELEMETRY_URL=https://sketchi.app/api/telemetry
```

## Smoke Test

Run the Convex action:

```bash
convex.sentrySmokeTest
```

Verify logs in Sentry with `sentry-cli` (see issue #89).
