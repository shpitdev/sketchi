# Effect conventions

Sketchi pins `effect` and `@effect/vitest` to `4.0.0-beta.99`. Effect owns
effectful orchestration in `diagram-generation`, `diagram-agent`,
`diagram-scenarios`, and `eval-harness`. Parsing, formatting, IR validation,
rendering, React/TanStack surfaces, and generators stay pure or
framework-native.

`packages/studio/projects` is migration-ready rather than Effect-forbidden.
Issue #240 will introduce Effect at its persistence boundary while its pure
data transformations remain ordinary TypeScript.

## Operations and observability

- Reusable effectful operations use `Effect.fn` with stable dotted identities
  such as `diagramGeneration.generate`. Add nested spans only for meaningful
  upstream or persistence boundaries.
- Span/log fields are bounded metadata: operation, provider, model, scenario or
  artifact ID, attempt, cache mode, and error tag. Never attach prompts,
  responses, credentials, or unbounded payloads.
- Count work at boundaries (requests, upstream attempts, retries, failures), not
  inside pure helpers. Configure exporters at the application layer.

## Services, layers, and runtimes

- External capabilities are `Context.Service` contracts. Production and test
  implementations are `Layer` values; business logic requires services and
  never provisions them locally.
- Compose layers once at an application or test boundary. A framework adapter
  may call `Effect.runPromise`; package and business APIs return `Effect`.
  Do not preserve a parallel Promise-primary implementation.
- Parameterized layer construction is restricted to runtime bindings. Build it
  once at the edge and reuse the resulting layer.

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
