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

Jev family decisions use `@effect/ai-typesafe` for question, answer and usage codecs.
Its credential-free `TypeSafeClient` receives an Effect `HttpClient` that transports
System One through Workers AI `AI.run`, prefixes the model with `typesafe/`, and
unwraps the binding response. `AI.run` has no abort signal: interruption stops waiting
but cannot establish that inference or billing stopped. This adapter is promoted to
native diagnostic errors; family questions, thresholds and timeout policy stay in
the narrowing service.

The icon author uses `@effect/ai-anthropic` with `Prompt` history and provider
metadata for signed/redacted thinking replay. Its native gateway transport forwards
the Effect HTTP abort signal and preserves cache, effort, fallback and token-budget
settings. A domain request-field transform retains the existing JSON output schema
with `generateText`, so the author's existing tolerant repair still owns invalid
replies.

The icon judge uses `@effect/ai-openai` on the Responses API with
`generateText`, low image detail, low reasoning effort and an output-token cap.
Like the author, each attempt has its own gateway transport that forwards the
Effect HTTP abort signal and reads the whole body inside that attempt, and a
request-field transform adds the reply's JSON schema, which the public config
does not expose. `generateObject` would discard a billed reply's usage when its
pick is unreadable; the domain's tolerant decoder turns such a reply into a
no-pick instead. HTTP failures keep the author's retry classification.

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

## Shared tools

Studio's `features/mcp/toolkit.server.ts` owns the public `docs`, `search` and
`execute` definitions and handlers. `execute.server.ts` owns sandbox settlement,
receipts and model delivery. Icons' `features/mcp/toolkit.server.ts` owns
`search_icons` and `get_icon`, with the request origin and source loader supplied
through `IconSource`. Both hosts use native `McpServer.toolkit` registration.

MCP is stateless across requests. `serveStatelessMcp` opens a request-owned
`McpServer.layerHttp` handler, initializes it internally for non-initialize POSTs,
and strips the native session header from the public response. The handler closes
after body consumption or cancellation. No Durable Object owns an MCP session.
HTTP middleware supplies request bindings and telemetry. Studio's
`features/build/capabilities.server.ts` supplies concrete artifact, icon and render
capabilities to the public diagram operations; it defines no operation facade.

Effect 4.1.4's Toolkit registration emits JSON text and structured content; its
`MiddlewareSuccess` is opaque. The shared registration-time content decorator maps
only the already-encoded native result to readable docs, artifact delivery and raw
SVG. Native registration retains input decoding, typed errors, interruption and
request context. It performs no schema redecoding or redispatch.

## Diagnostics

`pnpm ci:local` fails on correctness and Effect boundary errors. The native
compiler applies `tsconfig.base.json` across projects. Oxlint also checks raw
fetch, timers, Promise construction and Node built-in imports so scripts outside
the TypeScript reference graph are covered. Inside-Effect variants are errors too.

Collection and string preferences, `async` declaration shape, and standalone
synchronous JSON preferences remain advisory outside existing stricter files.
Pure layout and geometry retain their collection and string style exemptions,
not exemptions from correctness or I/O checks. API maturity is not a failure.

Use `@effect-diagnostics-next-line rule:off -- <concrete reason>` for a necessary
host call or deliberate synchronous boundary. A per-file, per-rule directive is
appropriate when a standalone build script or test harness repeats the same host
operation. The reason must name the contract or operation, not the package or
syntax. Do not disable a rule across an app or substitute an exception for a
needed correctness fix. Existing Nx dependency boundaries, Promise misuse checks,
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
