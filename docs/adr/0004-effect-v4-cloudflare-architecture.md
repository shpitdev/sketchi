# ADR 0004: Effect v4 on Cloudflare Workers

- Status: accepted
- Original decision: 2026-07-20
- Policy revision: 2026-11-14

## Context

Sketchi needs typed data and failures, cancellation, concurrency, scoped resources and
substitutable dependencies across diagram generation, rendering, browser state,
persistence, CLI and telemetry. The previous pure/UI exclusions and exact Promise-site
inventory divided that ownership and required a custom TypeScript checker. Upstream
Effect diagnostics now supply correctness and native-operation checks.

## Decision

Use Effect v4 and its ecosystem throughout the application and tools. Reuse upstream
data structures, schemas, algorithms, state and workflow facilities where they meet
the requirement. Keep Sketchi-specific geometry/layout and foreign renderers. React
owns rendering; Effect atoms and services own application state and workflows.
TanStack retains the navigation/SSR/build shell until a supported replacement is
proved. A native host callback is a boundary, not an exemption for the code around it.

Cloudflare Workers and Durable Objects remain the hosting platform. Services and
layers express dependencies, expected failures use typed tagged errors, and
interruption stays distinct from defects. Runtimes belong to explicit host/resource
lifecycles; imports must not start I/O or timers or capture request-owned state.
Use the supported scoped Node and browser services rather than parallel lifecycle
implementations. Retain only adapters for demonstrated upstream capability gaps.

Provider calls retain the Cloudflare AI Gateway binding and stored-key identity.
The CLI holds no gateway credential. Existing offline commands, released wire
contracts, stored data and quotas remain intact until their owning slice proves an
intentional change. Adoption is not permission to reset data or alter model policy.

The workspace catalog pins the synchronized Effect runtime packages. Compiler/lint
packages have independent compatible pins. Supported experimental/unstable APIs are
permitted; maturity alone does not require a wrapper or forbid adoption. Read installed
source contracts before relying on a capability.

## Enforcement and migration

The explicit upstream rule policy in `tsconfig.base.json` applies to domain, server,
React and tooling code. Correctness is error everywhere. The native-operation and
collection group starts as warnings in unconverted scopes and is promoted to error
as each scope is proved. Maturity rejection is off; style suggestions are not all
errors. [Effect conventions](../effect-conventions.md) define purpose-specific
expectations and local exception requirements.

Remove the obsolete pure/UI import bans, unstable-path adapter rules, exact Promise
counts and custom runtime/Promise compiler walkers. Nx and existing lint rules retain
dependency isolation, Promise misuse, schema and React synchronization boundaries.
The upstream diagnostics do not detect every Promise or outer runtime expression;
review host ownership and test actual resource/cancellation/isolation behavior rather
than preserving a syntax census. A green lint result is not lifecycle proof.

See the [Effect toolchain](../effect-toolchain.md) for the compiler, lint and Nx reference checks.

## Consequences

- Business APIs and internal workflows use Effect rather than Promise facades.
- Tests protect application invariants, meaningful boundaries and historical defects;
  they use upstream Effect test facilities where applicable.
- Runtime changes require real host, cancellation and ownership proof. Data changes
  require actual-shape inspection and migration, not hypothetical compatibility.
- Rendering quality and generation/build/runtime cost remain acceptance criteria.
- No retired Convex, Next.js, Vercel, Bun or Turborepo architecture returns.

## Revisit criteria

Revisit a host or adapter when a demonstrated product requirement cannot be met by
its supported capability and operating envelope. Revisit a diagnostic exception when
upstream supports the missing operation or the relevant application boundary changes.
Pure/UI identity and API maturity are not exclusion criteria.
