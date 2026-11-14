# Effect conventions

Effect v4 owns application data, algorithms for which it supplies an implementation,
state, workflows, I/O, concurrency, persistence and observability throughout Sketchi.
Domain, renderer, React and tooling packages may all import Effect. Use its synchronous
data and collection APIs for synchronous work; ordinary arithmetic does not need a
runtime. Keep Sketchi's geometry and rendering algorithms where upstream has no
replacement.

The workspace catalog pins the synchronized runtime line. Compiler and lint tools have
independent versions; see [the toolchain](effect-toolchain.md). Experimental or unstable
status alone is not a reason to reject a supported API. Use current package exports;
there is no special adapter directory for API maturity.

## Services and runtime ownership

- Public and nontrivial service operations use `Effect.fn` with stable dotted names.
  External capabilities are explicit `Context.Service` contracts supplied through layers.
- Business operations return Effect. Compose layers at an application, test or resource
  boundary, not inside business methods. Do not retain a parallel Promise implementation.
- Node entrypoints use `NodeRuntime.runMain`; Worker handlers and browser integrations
  use a lifecycle-owned runtime. A required native callback belongs in a small adapter
  with a concrete reason. Module imports must not start I/O, timers or a shared request
  runtime. Review cancellation, request isolation and finalization at that boundary.
- React renders and consumes Effect atoms. Atoms and Effect services own application
  state and workflows. TanStack retains its navigation/SSR/build responsibilities until
  an actual supported replacement is proved. Foreign renderer synchronization stays in
  one reviewed adapter; direct React effect hooks still require a local reason.
- Foreign calls propagate cancellation when supported. Use scoped process/resource
  services and upstream concurrency, cache and schedule primitives. Keep only the host
  integration upstream cannot provide; an Effect wrapper alone is not a conversion.

## Contracts, failures and tests

- Model ordinary records with `Schema.Struct` and a same-name interface. Use current
  tagged error constructors for expected failures. Do not assert plain objects into
  Schema class instances or erase error/requirement types to silence diagnostics.
- Decode unknown boundaries effectfully in server and asynchronous workflows. A
  deliberate synchronous domain decoder or trusted constructor is local and reasoned;
  it is not an exemption for every schema call in a package.
- Interruption is cancellation, distinct from expected failure and defects. Retry only
  known transient, safely repeatable operations, with bounded schedules and concurrency.
- Use `@effect/vitest`, explicit test layers and `TestClock` from `effect/testing` for
  Effect workflows. Test useful outcomes, including interruption, ownership, resource
  cleanup and persistence races. Preserve existing user data and wire contracts.
- Domain/family conversions retain deterministic geometry, rendering and cost proof.
  A test of framework behavior, emitted scaffolding, source spelling or a syntax count
  does not replace an application invariant.

## Diagnostic ratchet

`tsconfig.base.json` is the single executable policy for the pinned native compiler.
Its explicit correctness and Effect-native rule lists are shared by all four purposes;
no package is exempt because it is pure, UI, server or tooling. The following levels
apply before a scope is converted:

| Purpose | Correctness | Native operations and collections | Synchronous schema calls | Maturity |
| --- | --- | --- | --- | --- |
| Domain and rendering | error | warning | warning; deliberate synchronous boundaries need a local reason | off |
| Server and persistence | error | warning | warning during migration; converted I/O uses effectful decoding | off |
| React application | error | warning | warning; renderer callbacks do not exempt application workflows | off |
| Tooling and Node | error | warning | warning; native Nx/bootstrap callbacks remain narrow | off |

The native list includes both inside/outside-Effect variants supplied by upstream,
collection/string preferences, `runEffectInsideEffect`, `strictEffectProvide` and
`schemaSyncInEffect`. Correctness errors fail the compiler; migration warnings remain
visible and do not affect its exit code. Maturity checks (`experimentalApiUsage`,
`unstableApiUsage`, `apiStabilityLeak`) are off. Style rules keep their pinned upstream
defaults; they are not all promoted to errors.

Each converted project or family promotes this applicable native group to error using
upstream configuration overrides. Preserve the base correctness list and unrelated
scopes; a narrower list or lower severity requires independent review. Verify the
resolved policy on a real source probe before accepting a promotion. Final adoption
requires errors throughout and a concrete reason for every necessary native operation.
Record counts temporarily in `.memory/`; there is no allowed-count baseline in CI.

Prefer a local `@effect-diagnostics-next-line rule:off -- <concrete capability gap>`
only for an actual host contract or deliberate synchronous boundary. Do not suppress
correctness findings to make a migration pass, add package-wide suppressions, or use
an exception to preserve a duplicate implementation. Lint and Effect diagnostic
comments require reasons. Existing Nx dependency boundaries, Promise misuse checks,
Zod restrictions and React synchronization restrictions remain enforced.

Upstream diagnostics are not a census of Promise syntax. Assigned `Promise.resolve`
and `.then` calls and outer runtime runners can escape those diagnostics. Review
whether those operations have an actual host owner; prove lifecycle behavior with
relevant application tests. Do not recreate the removed compiler walker or exact file
counts to pretend coverage is identical. Nx isolates dependencies; it does not prove
that a runtime invocation inside a permitted package has the right owner.

## Observability

Reusable operations have stable span names. Logs carry bounded metadata, while
intentional prompt/model/body content belongs in span attributes using the existing
content policy and redaction boundary. Never record credentials. Correlation uses
`withTelemetryCorrelation`; request, run, attempt, scenario, project and artifact IDs
join retained events but are not metric attributes.

`@sketchi/observability` provides the request-owned tracer, logger and metric registry.
Preserve the existing Pipeline row/content/cause format, correlation and request-end
flush behavior during conversion. Verify emitted, retained and queryable evidence
separately; configuring telemetry is not proof that a request was recorded.
