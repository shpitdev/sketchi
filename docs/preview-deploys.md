# App Preview Deploys

## Official Worker Previews

GitHub Actions builds each Nx app and runs `wrangler preview --name pr-<number>`
against its existing Worker. It no longer creates a separate Worker per PR.

| Project        | Worker               | Stable Preview hostname                                |
| -------------- | -------------------- | ------------------------------------------------------ |
| `web`          | `sketchi-web`        | `pr-<number>-sketchi-web.<account>.workers.dev`        |
| `playground`   | `sketchi-studio`     | `pr-<number>-sketchi-studio.<account>.workers.dev`     |
| `icons`        | `sketchi-icons`      | `pr-<number>-sketchi-icons.<account>.workers.dev`      |
| `eval-harness` | `sketchi-playground` | `pr-<number>-sketchi-playground.<account>.workers.dev` |
| `excalidraw`   | `sketchi-excalidraw` | `pr-<number>-sketchi-excalidraw.<account>.workers.dev` |

Cloudflare's [Worker Previews](https://developers.cloudflare.com/workers/previews/)
provide branch-specific bindings, variables, secrets, and observability under an
existing Worker. They are separate from production versions/deployments, so they
cannot accidentally become a production version through `wrangler versions deploy`.
[Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
created by `wrangler versions upload --preview-alias` use version resources and
are not branch-isolated environments. We use Previews, not version aliases.
Workers Builds supports Previews too, but this repo retains GitHub Actions and Nx
as its build system.

## Data isolation

Each app declares a `previews` block in its checked-in Wrangler config. Production
settings stay at the top level. Previews do not inherit production variables or
bindings. Studio's Preview R2 bucket and both Pipeline streams are the existing
preview resources listed below; no data resources are created by this workflow.
AI, Browser Run, and Worker Loader bindings are configured explicitly where needed.
Assets and compatibility settings remain at the top level as required by Wrangler.

The workflow uses `--ignore-base-config` to exclude dashboard Preview base settings
when a PR Preview is created. It does not import production secrets or upload
secrets. These apps use configured API bindings without Worker secrets. If a future
feature requires secrets, provision preview-only credentials through a separately
reviewed change. Do not copy production secrets into the Preview base.

`scripts/01-validate-preview-config.mjs` checks the generated build config before
upload: Worker identity, explicit runtime bindings, and that `previews` binds every
production R2 bucket and Pipeline stream binding to a non-production target (the
R2 target must match the top-level `preview_bucket_name`). Any other `previews`
field, such as KV, D1, or service bindings, fails until its isolation is reviewed.
Cloudflare [resources and isolation](https://developers.cloudflare.com/workers/previews/resources/)
explains that R2 and Pipelines isolation depends on binding separate resources;
service bindings currently call the target Worker's production deployment.

## Workflow and comments

Same-repository pull requests to `main` deploy all five apps. Forks are excluded.
Manual dispatch takes an open same-repository PR number and resolves its head SHA
before checkout; the same SHA appears in deploy metadata and comments.

- The shared mise setup uses the repository's exact Node/pnpm pins and a frozen lockfile.
- Each build writes assets to `dist/apps/<project>/client` and the deploy snapshot
  to `dist/apps/<project>/server/wrangler.json`. There is no transformed preview config.
- `wrangler preview` writes a `preview` entry to its structured output file
  (`WRANGLER_OUTPUT_FILE_PATH`) with the stable Preview URL and an immutable
  deployment URL. The URL reader checks the Worker and Preview name and comments
  only the stable workers.dev URL. Missing or disabled Preview URLs fail the job.
- One owned sticky bot comment per app reports status, commit, URL, and workflow run.
- Web receives sibling official Preview URLs through `--var` so its Icons and
  Playground links stay on the same PR. These overrides affect only the Preview.

`web`, `playground`, and `icons` are public product surfaces. `eval-harness` and
`excalidraw` remain internal and are not linked from public navigation.

Pipeline-bound Playground uploads share `cloudflare-pipeline-bound-upload` with
production. `queue: max` queues pending jobs without cancelling active uploads;
other apps retain their per-app/per-PR concurrency policies.

## Required configuration

- GitHub `staging`: `CLOUDFLARE_ACCOUNT_ID` variable or secret and
  `CLOUDFLARE_API_TOKEN` secret with Workers edit/deploy and bound-resource access.
- GitHub `production`: separate production credentials for production deploys.
- `CHROMATIC_PROJECT_TOKEN`: staging secret for the CI Storybook gate.

Infisical project `sketchi`, path `/github`, is the source of GitHub environment
secrets: `staging` maps to GitHub `staging`; `prod` maps to GitHub `production`.
Do not combine both environments in repository-wide secrets. `GRAPHITE_TOKEN` is
optional and is not required by these workflows.

The existing Workers must have workers.dev Preview URLs enabled. If disabled,
apply that setting through the normal production/operator workflow, not by
publishing PR code with `wrangler deploy`. Missing Cloudflare credentials produce
an `unconfigured` comment rather than a successful preview claim.

## Cleanup and legacy Workers

Closing a PR runs `cleanup-preview`, which deletes Preview `pr-<number>` from each
of the five Workers through the Cloudflare Previews API and marks the sticky
comment `deleted`. A missing Preview (HTTP 404) counts as already deleted. The job
shares `deploy-preview`'s concurrency group, so a queued deploy cannot recreate a
Preview after it is deleted. Cloudflare also evicts the least recently deployed
Preview at its limit (100 Free / 500 Paid per Worker; 100 deployments per Preview).

Legacy `sketchi-*-pr-*` Workers from the previous per-PR Worker flow are untouched
by this migration. Remove them separately; this workflow never deletes a Worker.

## Operational scripts

- `00-resolve-worker-app.mjs`: resolve and validate project/Worker identity.
- `01-validate-preview-config.mjs`: validate the built Preview settings and PR name.
- `02-extract-preview-url.mjs`: read the Preview entry from Wrangler's output file; production still parses its deploy log.
- `03-upsert-preview-comment.mjs`: update only the owned, anchored bot comment.
- `05-prepare-production-domain-deploy.mjs`: prepare an explicitly requested production domain config.

## Production Worker Deploys

The `app-production-deploy` workflow runs on pushes to `main` and deploys the
five wired production Workers without assigning final custom domains. Production
deploys also pass `--no-x-provision`; Workers may bind existing resources, but
CI deploys do not create or discover storage.

Those deploys keep `workers_dev` enabled so the app can be verified from
Cloudflare-owned `workers.dev` URLs before any DNS or registrar cutover.
Production deploy summaries include the same public/internal route policy and
the custom domains that would be attached by a manual domain dispatch. Internal
apps report no custom domains.

The Studio Worker binds Code Mode artifacts to R2 and Code Mode usage analytics
to Cloudflare Pipelines:

| Surface                  | Binding                 | Remote target                                  |
| ------------------------ | ----------------------- | ---------------------------------------------- |
| Studio Previews          | `SKETCHI_ARTIFACTS`     | `sketchi-studio-codemode-artifacts-preview`    |
| Studio production Worker | `SKETCHI_ARTIFACTS`     | `sketchi-studio-codemode-artifacts-production` |
| Studio Previews          | `CODEMODE_USAGE_EVENTS` | `e9fc3bcd35314fa39fc6a89018207acc`             |
| Studio Previews          | `CODEMODE_USAGE_ISSUES` | `d95a1767edf246af8c637c5b9bf5a5c5`             |
| Studio production Worker | `CODEMODE_USAGE_EVENTS` | `d9044253316f4273a60298098f444a62`             |
| Studio production Worker | `CODEMODE_USAGE_ISSUES` | `f687dab6e7d742c1a76834089e709462`             |

The checked-in `previews` block binds Studio Previews directly to the preview
bucket and preview Pipeline streams. There is no generated resource rewrite. Production deploys
keep production buckets and production streams. All Worker-bound buckets and
streams must exist before their Workers deploy. The downstream R2 Data Catalog
sinks are long-lived Cloudflare Pipeline resources, not Worker bindings. They
write into `sketchi-codemode-usage-analytics-production-v4` and
`sketchi-codemode-usage-analytics-preview-v4`; run
`pnpm r2sql:codemode:resources` to print the sink, pipeline, bucket, and table
map. Preview resources are named explicitly and must already exist; the command does
not provision data resources. The CI token does not need R2 object read access
just to deploy.

R2 Data Catalog verification must prove an aggregate R2 SQL data scan through
the direct R2 SQL API, not just `SHOW TABLES` or `DESCRIBE`, because
metadata-only catalog calls can succeed before rows are queryable. The
2026-06-29 real end-to-end check called production and preview Studio APIs with
unique `x-sketchi-run-id` headers, then verified both `usage_events` and
`usage_issues` rows in the v4 catalog buckets with
`pnpm r2sql:codemode:verify-run -- --require-issues`. The verifier polls R2
SQL by default. For normal successful API runs, issue rows may be absent; the
command only requires issue rows when `--require-issues` or explicit
issue-run-id options are supplied.

Wrangler accepts Pipeline stream names in local dry-runs, but the deploy API
requires stream IDs for Worker bindings. Keep `apps/playground/wrangler.jsonc` on
the production stream IDs and keep `previews.pipelines`
on the preview stream IDs. The validator rejects Previews bound to production targets.

Custom domains are a post-merge operator action. The production workflow writes
a generated `dist/apps/<project>/server/wrangler.domains.json` config from
`scripts/05-prepare-production-domain-deploy.mjs` and deploys that route-bearing
config only when explicitly dispatched with `domain_action=attach`. Follow
[Production domain cutover](production-domain-cutover.md); never attach domains
from a pull request or before the Cloudflare zone is active.

When `domain_action=attach`, the production domain helper attaches
`playground.sketchi.app` to the `playground` project while retaining the
`sketchi-studio` Worker service. Authenticated Studio is not exposed, even
though the Playground host has `/projects` and persisted
`/diagrams/:diagramId` route foundations. The
`eval-harness` has no public domain patterns; it deploys to the durable internal
`sketchi-playground` Worker.

The eval harness and standalone Excalidraw workspace should remain unlinked from
public navigation. Do not attach a public `excalidraw.sketchi.app` product route
unless that product-route decision is explicitly reopened.
