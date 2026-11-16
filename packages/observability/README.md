# observability

Workers-compatible Effect telemetry for Sketchi: every finished span, with its
full content, as a row for the spans Pipeline stream.

```mermaid
flowchart LR
  Request["request root span"] --> Owner["request's spans"]
  Spans["spans, logs, metric updates"] --> Owner
  Owner -->|"request scope closes (waitUntil)"| Stream["TELEMETRY_SPANS stream"]
  Stream --> Table["R2 Data Catalog observability.spans"]
```

| Owns                                                 | Does not own                          |
| ---------------------------------------------------- | ------------------------------------- |
| the tracer, logger and metric exporter               | what each span records (its callers)  |
| span rows, their splitting, and per-request sends    | the Pipeline, sink and catalog        |
| request correlation: ray, run, attempt and other IDs | DuckDB views (`tools/ops/src/telemetry`) |
| the stream schema, `spans.schema.json`               | AI Gateway request logging            |

`withTelemetryExport` makes the current span a request's root; the request's
spans are sent when the scope the host passes closes, so the host closes it after
the request's late work, under `waitUntil`.

Limit: a request's rows are sent once, when its scope closes. If the isolate dies
before then, every row of that request is lost; AI Gateway logs still show its
model calls. `withSpanContent` and `SpanContent` name the content
a span records. The layer performs no module-scope I/O and starts no timers.
`makeTelemetryTestSink` receives every span as it finishes, for tests.

## Commands

```sh
pnpm nx test observability
pnpm nx typecheck observability
pnpm nx build observability
```
