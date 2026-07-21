# Effect v4 program-closure inventory

This inventory classifies the repository-wide 2026-07-20 scan for `async`,
`Promise`, `throw`, and `.catch(`: 844 matching lines in 147 TypeScript or
JavaScript files across `apps/`, `packages/`, `tools/`, and `scripts/` (build,
Wrangler, coverage, and generated output directories excluded). The groups
below are exhaustive and intentionally use stable path ownership instead of a
brittle line dump.

The count is reproducible from the repository root, including hidden config
directories:

```sh
rg --hidden --line-number \
  --glob '*.{ts,tsx,mts,cts,js,mjs}' \
  --glob '!**/dist/**' --glob '!**/.output/**' \
  --glob '!**/.wrangler/**' --glob '!**/coverage/**' \
  '\b(async|Promise|throw)\b|\.catch\(' \
  apps packages tools scripts | wc -l

rg --hidden --files-with-matches \
  --glob '*.{ts,tsx,mts,cts,js,mjs}' \
  --glob '!**/dist/**' --glob '!**/.output/**' \
  --glob '!**/.wrangler/**' --glob '!**/coverage/**' \
  '\b(async|Promise|throw)\b|\.catch\(' \
  apps packages tools scripts | wc -l
```

| Classification                      | Exhaustive scope                                                                                                                                                                                                                                                                                                                           | Rationale                                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effect-authoritative                | effectful code in `apps/cli`, `apps/eval-harness/src/lib`, `apps/playground/src/server`, `packages/diagram/{agent,generation,scenarios}`, `packages/observability`, `packages/studio/projects/src/server`, `tools/harness-eval.ts`, and `scripts/pipelines/r2-catalog-smoke.mjs`                                                           | I/O, time, concurrency, resources, expected failures, and orchestration return Effect. Throws inside pure parsers/constructors are defects or are captured immediately at the Effect boundary.                               |
| Pure                                | `packages/diagram/{core,renderer,excalidraw}`, `packages/svg-excalidraw`, deterministic scenario grading/argv helpers, contract fixtures, and ordinary unit-test data                                                                                                                                                                      | Synchronous validation, geometry, layout, formatting, and test assertions own no resource or async lifecycle. Effect Schema imports in the three core contract files define data; they do not make the algorithms effectful. |
| Framework edge                      | TanStack route/server-function adapters, React components/hooks, AI SDK/MCP callbacks, Cloudflare binding adapters, app Vite/Storybook config, and browser/component tests. Hidden Storybook configs are explicitly `apps/{excalidraw,icons,native-conversion-storybook}/.storybook/main.ts` and `packages/diagram/ui/.storybook/main.ts`. | The host requires Promise callbacks or browser-native Promise APIs. Each server adapter decodes/imports, invokes one approved Effect runtime, and encodes; product workflow does not live here.                              |
| Generated                           | `routeTree.gen.ts`, generated Cloudflare binding declarations, icon review/output assets, generator templates/fixtures, and build output excluded by the scan                                                                                                                                                                              | Regenerated from an upstream tool or data set; never an orchestration authority.                                                                                                                                             |
| Straightforward deployment plumbing | remaining `scripts/**/*.mjs`, `tools/local-dev-ports.ts`, and Worker/deploy/onboarding scripts and tests, excluding the Effect-authoritative R2 catalog lifecycle above                                                                                                                                                                    | One-shot, fail-fast host automation: resolve config, call a CLI/API, write a deployment artifact, or assert output. It does not implement product workflows or own long-lived resources.                                     |

## Reviewed native Promise sites

The structural test builds a TypeScript program, resolves expression types, and
stores both the exact current file allowlist and per-file type-identity site
counts. Calls, constructions, awaits, async returns, and thenable member access
are classified when their resolved types are assignable to `PromiseLike` or
the platform Promise constructor. Every union or intersection constituent is
checked after use-site instantiation and nullable/optional handling, so ordinary
`MaybePromise` returns and optional-chained thenable consumption are included.
Qualified constructors, local aliases, import-renamed/re-exported aliases,
dynamic imports, fetch, static calls such as `resolve`/`withResolvers`, and
direct or computed thenable consumers therefore share one semantic rule. The
reviewed sites are:

- host entrypoints that call one composed Effect program;
- packaged CLI build/smoke scripts and generator code;
- React/browser UI code for clipboard, file, canvas, and lazy-module APIs;
- TanStack route/server-function and RPC adapters;
- Cloudflare/AI/MCP foreign callbacks, including the Pipeline write adapter;
- reviewed persistence client/bucket edges that implement native host
  interfaces.

There is no unmanaged Promise lifecycle in the scenario process service,
scenario CLI, live scenario generator, harness-eval, eval-harness generation,
or R2 catalog smoke workflow. Adding a type-identified site or increasing the
reviewed site count fails `tools/project-graph.test.ts`.

This is structural drift protection, not an adversarial-code sandbox. It
depends on resolvable TypeScript types. The remaining exclusions are genuinely
unresolvable constructs: deliberate `any`/`unknown` laundering, `eval`, and
generated runtime code. Those remain explicit code-review responsibilities.

The R2 catalog smoke owns real remote resources and is not deployment
plumbing. Its Wrangler child process is scoped and process-group terminated;
provisioning registers cleanup before the first remote mutation; readiness and
query polling use interruptible Effect time; fetches forward cancellation; and
cleanup runs as an uninterruptible scope finalizer. Its focused test interrupts
a real command tree and proves the descendant is gone. An OS-level SIGTERM
regression additionally proves the Node main fiber is interrupted, its stubborn
descendant is killed, and a scope cleanup marker is written before exit.

## Runtime and schema audit

Approved production runtime boundaries are exactly the CLI host, Playground
runtime composition root, eval-harness server-function host, both internal
scenario hosts, and harness-eval host. Runtime execution below those files is a
test failure. The single unstable import is the internal public-CLI adapter.

Every direct `effect` or `@effect/*` declaration uses the exact approved
`4.0.0-beta.99` version; the lockfile contains no Effect v3. Effect-bearing
manifests are an exact allowlist. Source imports no Zod. Shared/domain schemas
are Effect Schema contracts; Standard Schema or synchronous decoders appear
only at framework edges.

The public CLI surface is exactly `create`, `show`, `edit`, `list`, `export`,
and `generate`. Scenario and harness entrypoints stay internal. `generate`
makes one unauthenticated HTTPS call to the public Sketchi generate API and
holds no credential; the Cloudflare AI Gateway binding runs server-side. Manual
commands remain offline.
