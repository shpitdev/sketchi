# Effect conventions

Sketchi exact-pins `effect` and every `@effect/*` package to the approved
`4.0.0-beta.99` substrate. Effect owns
effectful orchestration in `diagram-generation`, `diagram-agent`,
`diagram-scenarios`, `studio/projects`, `observability`, and the Worker runtime
boundaries in `playground` and `eval-harness`. Parsing, formatting, IR
validation, rendering, React/TanStack surfaces, and generators stay pure or
framework-native.

There is no `@effect/cli` dependency. Beta upgrades happen only in dedicated
changes with full proof.

## Operations and observability

- Reusable effectful operations use `Effect.fn` with stable dotted identities
  such as `diagramGeneration.generate`. Add nested spans only for meaningful
  upstream or persistence boundaries.
- Span/log fields are bounded metadata: operation, provider, model, scenario or
  artifact ID, attempt, cache mode, and error tag. Never attach prompts,
  responses, credentials, or unbounded payloads.
- Count work at boundaries (requests, upstream attempts, retries, failures), not
  inside pure helpers. Configure exporters at the application layer.
- Correlation uses `withTelemetryCorrelation`; nested calls merge request,
  run, attempt, scenario, project, and artifact identifiers through Effect
  context and annotations. Correlation identifiers link events but are never
  metric attributes.
- Logs inside the Effect ring use `Effect.log*` with approved static messages
  and allowlisted scalar fields. Do not log causes, prompts, artifacts, request
  bodies, response bodies, or arbitrary object serialization.

## Workers telemetry

`@sketchi/observability` installs one tracer, logger, and isolated metric
registry in an application-owned Effect scope. The live sink emits bounded JSON
events to Workers Logs with Effect trace and span identifiers. Allocation and
shutdown belong to the layer scope; the package performs no module-scope I/O,
starts no timers, and owns no global mutable correlation state.

The exporter complements Cloudflare surfaces. It does not change AI Gateway
`collectLog`, Code Mode usage-event rows, Pipeline streams, R2 catalog targets,
or R2 SQL verification queries.

## Services, layers, and runtimes

- External capabilities are `Context.Service` contracts. Production and test
  implementations are `Layer` values; business logic requires services and
  never provisions them locally.
- Compose layers once at an application or test boundary. A framework adapter
  may call `Effect.runPromise`; package and business APIs return `Effect`.
  Do not preserve a parallel Promise-primary implementation.
- Executable Node entrypoints use `NodeRuntime.runMain`, so SIGINT and SIGTERM
  interrupt the main fiber and wait for scoped process-tree and remote-resource
  finalizers before exit. `Effect.runPromise` is not a Node main-loop adapter.
- Parameterized layer construction is restricted to runtime bindings. Build it
  once at the edge and reuse the resulting layer.
- Node child processes are scoped resources. Timeout is measured until process
  exit; close receives a separate bounded grace for inherited stdio. Timeout or
  interruption targets the owned process group/tree with SIGTERM, escalates to
  SIGKILL, force-settles after a final bound, and always releases descendants,
  listeners, and streams.
- Provisioning scripts that create remote resources are Effect-authoritative,
  not ordinary deployment plumbing. Register cleanup in a scope before the
  first mutation, use interruptible Effect polling, forward fetch cancellation,
  and make finalizers best-effort and complete.

## Failures, resilience, and cancellation

- Expected failures use `Schema.TaggedErrorClass`. Wrap an SDK, fetch, or other
  foreign failure once at its boundary and retain the original cause.
- Retry only errors explicitly classified as transient. Policies use bounded
  `Schedule` retries, per-attempt timeouts, and bounded `Effect.forEach`
  concurrency. Permanent HTTP/configuration/decode failures fail immediately.
- Interruption is cancellation, not a domain error. Do not catch a full cause
  and translate interrupts; `tryPromise` adapters pass an `AbortSignal` when
  the foreign API supports it.

## Imports and tests

- Stable `effect` and `effect/testing` imports are allowed in
  Effect-authoritative projects. `effect/unstable/*` is allowed only in a
  reviewed `src/internal/effect-unstable-*.ts` adapter with a documented reason.
- Use `@effect/vitest` for Effect tests, `TestClock` from `effect/testing` for
  retry/timeout timing, and explicit layers for success and failure variants.
  Test interruption and layer substitution whenever a new external service is
  introduced.
- Pure helpers and framework-native projects do not import Effect. Keep their
  ordinary unit tests and deterministic contracts intact.

## Structural closure

`tools/project-graph.test.ts` is the executable boundary inventory. It pins the
allowed manifests and unstable adapter, rejects Effect v3 and Zod source
imports, enumerates runtime host edges, and enumerates the remaining native
Promise sites and counts. The TypeScript type-checker gate resolves
Promise/PromiseLike identity and assignability for async returns, awaits,
constructions, calls, and thenable member access, including qualified and
aliased forms. Union/intersection constituents, generic use-site instantiation,
and nullable/optional consumption are included. Adding a file or a site fails
the test until its ownership is deliberately classified.

The full rationale and exhaustive glob classification are checked in at
[Effect v4 program-closure inventory](effect-program-closure-inventory.md).
