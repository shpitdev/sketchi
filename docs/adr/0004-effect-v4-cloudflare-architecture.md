# ADR 0004: Effect v4 on Cloudflare Workers

- Status: accepted
- Date: 2026-07-20

## Context

Sketchi needs one architecture for model generation, Code Mode, artifact and
Studio persistence, Browser Rendering, evaluation, and telemetry. These flows
need typed failures, cancellation, time, retry, concurrency, scoped resources,
and substitutable tests. The product already relies on Cloudflare Workers, AI
Gateway, Browser Rendering, R2, Pipelines, and R2 SQL.

## Decision

Effect v4 is authoritative for non-trivial effectful work. Services and layers
express dependencies; Effect Schema owns domain and protocol contracts;
schema-backed tagged errors represent expected failures; interruption and
defects remain distinct; resources are scoped; runtime execution occurs only
at approved host edges.

Cloudflare Workers remain the application runtime. This is not a temporary
bridge. Provider calls use the Cloudflare AI Gateway binding server-side; the
binding authenticates the request and supplies the stored provider key. The CLI
holds no gateway credential: it reaches generation through one unauthenticated
HTTPS call to the public Sketchi generate API, and every other CLI command is
strictly offline.

Deterministic IR validation, layout, geometry, rendering transformations, and
formatting stay plain TypeScript. React view state and rendering stay React.
TanStack, AI SDK, MCP, Cloudflare, Storybook, browser, and Nx adapters may use
their native Promise contracts only at the outer edge.

Node tooling follows the same rule. Shell-backed commands own a dedicated
process group/tree so timeout and interruption terminate descendants, not only
the immediate shell. Remote provisioning, including the R2 Data Catalog smoke
lifecycle, registers cleanup before its first mutation and uses scoped,
interruptible Effect polling and fetch boundaries. Executable Node hosts use
`NodeRuntime.runMain`, which translates SIGINT/SIGTERM into fiber interruption
and lets scoped process-tree and remote-resource finalizers finish before exit.

The repository exact-pins `effect` and every `@effect/*` dependency to the
approved `4.0.0-beta.99` version. Upgrades are dedicated changes, never
incidental range movement. Unstable modules require one reviewed
package-internal adapter; the current sole adapter is the CLI adapter.

## Consequences

- Business APIs return Effect rather than Promise facades.
- Tests substitute layers and use `@effect/vitest` and `TestClock` for time,
  interruption, and cleanup.
- Structural tests enumerate package rings, runtime boundaries, unstable
  imports, and reviewed native Promise files and TypeScript type-identity site
  counts, and reject Zod re-entry. The checker resolves Promise/PromiseLike
  assignability across qualified, aliased, import-renamed, and re-exported
  forms rather than matching spellings, and examines every union/intersection
  constituent after generic instantiation and nullable/optional handling.
- This gate is structural drift protection, not an adversarial-code sandbox.
  Only genuinely unresolvable type-level constructs remain outside automation:
  deliberate `any`/`unknown` laundering, `eval`, and generated runtime code.
  They must be rejected in code review.
- Worker bundle and runtime cost are measured with each meaningful change.
- The repository carries no retired Convex, Next.js, Vercel runtime, Bun, or
  Turborepo compatibility path.

## Revisit criteria

Revisit Cloudflare only when a proven product requirement cannot be implemented
correctly with Workers and Durable Objects, such as a durable long-running
workflow whose correctness or operating envelope demonstrably exceeds those
primitives. General preference, framework novelty, or Effect compatibility is
not sufficient.

Revisit pure/UI exclusions only when code begins to own real I/O, time,
concurrency, resources, or expected failures. Do not introduce Effect into
deterministic algorithms or React state for uniformity alone.
