# App Preview Deploys

## Official Worker Previews

GitHub Actions builds each Nx app and runs `wrangler preview --name pr-<number>`
against its existing Worker. It no longer creates a separate Worker per PR.

| Project      | Source         | Worker               | Stable Preview hostname                                |
| ------------ | -------------- | -------------------- | ------------------------------------------------------ |
| `web`        | `apps/web`     | `sketchi-web`        | `pr-<number>-sketchi-web.<account>.workers.dev`        |
| `studio`     | `apps/studio`  | `sketchi-studio`     | `pr-<number>-sketchi-studio.<account>.workers.dev`     |
| `icons`      | `apps/icons`   | `sketchi-icons`      | `pr-<number>-sketchi-icons.<account>.workers.dev`      |
| `editor`     | `apps/editor`  | `sketchi-excalidraw` | `pr-<number>-sketchi-excalidraw.<account>.workers.dev` |

Cloudflare's [Worker Previews](https://developers.cloudflare.com/workers/previews/)
provide branch-specific bindings, variables, secrets, and observability under an
existing Worker. They are separate from production versions/deployments, so they
cannot accidentally become a production version through `wrangler versions deploy`.
[Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
created by `wrangler versions upload --preview-alias` use version resources and
are not branch-isolated environments. We use Previews, not version aliases.
Workers Builds supports Previews too, but this repo retains GitHub Actions and Nx
as its build system.

A Preview did not confirm that Studio chat Stop ends the provider call. Closing an MCP transport interrupted the host `execute` spans, but that exercises a different path.

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

`pnpm ops preview settings` checks the generated build config before
upload: Worker identity, explicit runtime bindings, and that `previews` binds every
production R2, D1 and Pipeline binding to a non-production target. When a binding declares `preview_bucket_name` or `preview_database_id`, the preview
bucket name or database ID must match it.
Icons Previews share that preview database, not the production database. The
[validator](../tools/ops/src/deploy/preview.ts) rejects unreviewed binding keys
and unsupported fields such as KV and service bindings.
Cloudflare [resources and isolation](https://developers.cloudflare.com/workers/previews/resources/)
explains that R2 and Pipelines isolation depends on binding separate resources;
service bindings currently call the target Worker's production deployment.

## Workflow and comments

Previews are opt-in. A same-repository pull request to `main` with the `preview`
label deploys the apps it affects (`nx show projects --affected` between the PR's
merge base and head) on every push; a change to the preview tooling itself
(`app-preview.yml`, the shared setup action, `tools/ops/src/deploy/` and the ops command entry)
deploys all four. Unlabelled PRs deploy nothing, and adding another label runs
nothing. Forks are excluded. Closing a same-repository PR deletes all four
Previews when one can exist: the PR carries the `preview` label or a preview
comment, however the Preview was deployed (including before previews were
opt-in). Closing a PR with neither runs no cleanup jobs.

Manual dispatch takes an open same-repository PR number, including a stacked PR
whose base is not `main`, and a `project` choice (`affected`, `all`, or one app).
Use a workflow ref with the same project names as the PR head. The dispatch
choices come from the workflow ref; the build and selectors come from the PR head.
The workflow resolves the PR head SHA before checkout; that SHA appears in deploy
metadata and comments. It also adds the `preview` label before anything uploads,
so closing the PR cleans up even if no Preview comment exists yet, and later
pushes keep the PR's affected Previews current. Dispatch only the project you need.
Remove the label between completed runs, and only once the bot's Preview comment exists for cleanup.
For routing or rendering changes, replay the relevant scenarios against the Studio
preview MCP (`pr-<number>-sketchi-studio`) and inspect a small set of exported PNGs.

- The shared mise setup uses the repository's exact Node/pnpm pins and a frozen lockfile.
- Each build writes assets to `dist/apps/<project>/client` and the deploy snapshot
  to `dist/apps/<project>/server/wrangler.json`. There is no transformed preview config.
- `wrangler preview` writes a `preview` entry to its structured output file
  (`WRANGLER_OUTPUT_FILE_PATH`) with the stable Preview URL and an immutable
  deployment URL. The URL reader checks the Worker and Preview name and comments
  only the stable workers.dev URL. Missing or disabled Preview URLs fail the job.
- One owned sticky bot comment per app reports status, commit, URL, and workflow run.
- Web receives sibling official Preview URLs through `--var` so its Icons and
  Playground links stay on the same PR when the same run deploys them; otherwise
  they point at production. These overrides affect only the Preview.

`web`, `studio`, and `icons` are public product surfaces. `editor` remains
internal and is not linked from public navigation. The [diagram family gallery](../tools/storybook/native-conversion/README.md)
is for local visual review, not Worker Preview or deployment verification.

Pipeline-bound Studio and Icons uploads share
`cloudflare-pipeline-bound-upload` with production. `queue: max` queues pending
jobs without cancelling active uploads; other apps retain their per-app/per-PR
concurrency policies.

Wrangler retries transient `assets-upload-session` failures, including HTTP 500
with code 10013, up to three total attempts. This retries the session request,
not the deployment command
([cloudflare/workers-sdk#16562](https://github.com/cloudflare/workers-sdk/pull/16562)).

## Required configuration

- GitHub `staging`: `CLOUDFLARE_ACCOUNT_ID` variable or secret and
  `CLOUDFLARE_API_TOKEN` secret with Workers edit/deploy and bound-resource access.
- GitHub `production`: separate production credentials for production deploys.

Infisical project `sketchi`, path `/github`, is the source of GitHub environment
secrets: `staging` maps to GitHub `staging`; `prod` maps to GitHub `production`.
Do not combine both environments in repository-wide secrets. `GRAPHITE_TOKEN` is
optional and is not required by these workflows.

The existing Workers must have workers.dev Preview URLs enabled. If disabled,
apply that setting through the normal production/operator workflow, not by
publishing PR code with `wrangler deploy`. Missing Cloudflare credentials produce
an `unconfigured` comment rather than a successful preview claim.

## Cleanup and legacy Workers

Closing a PR runs `cleanup-preview`. `pnpm ops preview delete` deletes
Preview `pr-<number>` from each of the four Workers through the Cloudflare Previews
API; a missing Preview (HTTP 404) counts as already deleted. A successful delete
can leave the Preview hostname serving the deleted code
([cloudflare/workers-sdk#15945](https://github.com/cloudflare/workers-sdk/issues/15945)),
so the command then checks the Preview URL every 10 seconds (each check bounded to 10
seconds) for up to 2 minutes until
Cloudflare answers with its no-Preview 404 (`x-preview-user-error: true`). Only then
is the sticky comment marked `deleted`. If the URL still serves, the comment is
marked `deletion-pending` with the reachable URL and the job fails, so the leak
stays visible. The job
shares `deploy-preview`'s concurrency group. Once a deploy job holds that lock, it
re-checks the PR state right before `wrangler preview` and skips the upload if the
PR has closed, so a deploy that was queued at close time doesn't recreate the
Preview. A PR that closes during the upload itself is still handled: its cleanup
job waits for the same lock and deletes the Preview afterwards. Cloudflare also evicts the least recently deployed
Preview at its limit (100 Free / 500 Paid per Worker; 100 deployments per Preview).

Legacy `sketchi-*-pr-*` Workers from the previous per-PR Worker flow are untouched
by this migration. Remove them separately; this workflow never deletes a Worker.

## Operator commands

The workflows run typed `pnpm ops` commands from `tools/ops`; `pnpm ops --help` lists them.

- `worker resolve`: resolve and validate project/Worker identity.
- `preview select`, `production select`: choose the Worker apps a run deploys.
- `preview settings`: validate the built Preview settings and PR name, and write Web's sibling Preview URLs.
- `preview url`, `production url`: read the Preview entry from Wrangler's output file, or the workers.dev URL from a production deploy log.
- `preview comment`: update only the owned, anchored bot comment.
- `preview delete`: delete this PR's Preview of one Worker and confirm its URL stopped serving.
- `production domains`: require the active zone and prepare an explicitly requested production domain config.
- `production detach`: detach only the app's approved domains that still point at its Worker.

## Production Worker Deploys

The `app-production-deploy` workflow runs on a push to `main` and by manual
dispatch. A push deploys only the Worker apps whose `build` inputs it reaches
from the previous `main` commit (`ops production select --project affected`);
its path filter skips pushes of only root docs (`docs/`, root Markdown),
`.github` or tooling outside the app build inputs. Selection follows Nx build
inputs, so it is conservative: an app's own README or test config redeploys
that app, and a push that also touches `tools/ops` redeploys every app. The
`production` environment has no approval gate. A dispatch deploys all configured Worker apps or
one named project. A failed deployment leaves the last deployed version active
until the next push reaching that app or a dispatch. Production deploys pass
`--no-x-provision`; Workers may bind existing resources, but these deploys do
not create or discover storage. Domain attachment remains an explicit action.

Production deploys keep `workers_dev` enabled.
Production deploy summaries include the same public/internal route policy and
the custom domains that would be attached by a manual domain dispatch. Internal
apps report no custom domains.

[Studio's Wrangler config](../apps/studio/wrangler.jsonc) binds `SKETCHI_ARTIFACTS`
(Code Mode artifacts) and `TELEMETRY_SPANS` (request spans, including Code Mode usage)
to separate preview and production resources.

`TELEMETRY_SPANS` is not `remote`, so local development writes to a local stream
rather than production's. Every Preview shares the preview spans stream; the
`url.full` attribute of `playground.request` names the Preview host. The spans
path is described in [architecture](architecture.md#persistence-and-telemetry),
and `pnpm db --preview` queries what a Preview recorded.

The checked-in `previews` block binds Studio Previews directly to the preview
bucket and preview spans stream. There is no generated resource rewrite.
Production deploys keep production buckets and the production stream. All
Worker-bound buckets and streams must exist before their Workers deploy. The
downstream R2 Data Catalog sinks are long-lived Cloudflare Pipeline resources,
not Worker bindings. They write into `sketchi-telemetry-production` and
`sketchi-telemetry-preview`; `pnpm telemetry:resources` prints their map.
Preview resources are named explicitly and must already exist; deploys do not
provision data resources. The CI token does not need R2 object read access just
to deploy.

To check that a Preview records a call, send it with a unique `x-sketchi-run-id`
and wait about two minutes for the sink to roll. Then
`pnpm db --preview -c "FROM usage_events WHERE run_id = '<id>'"` returns its
usage row, and `span_tree` on its `trace_id` returns its spans.

Wrangler accepts Pipeline stream names in local dry-runs, but the deploy API
requires stream IDs for Worker bindings. Keep `apps/studio/wrangler.jsonc` on
the production stream IDs and keep `previews.pipelines`
on the preview stream IDs. The validator rejects Previews bound to production targets.

Custom domains are a post-merge operator action. The production workflow writes
a generated `dist/apps/<project>/server/wrangler.domains.json` config from
`pnpm ops production domains` and deploys that route-bearing
config only when explicitly dispatched with `domain_action=attach`. Follow
[Production domains](production-domain-cutover.md); never attach domains
from a pull request or before the Cloudflare zone is active.

When `domain_action=attach`, the production domain helper attaches
`playground.sketchi.app` to the `studio` project while retaining the
`sketchi-studio` Worker service. Authenticated Studio is not exposed, even
though the Playground host has `/projects` and persisted
`/diagrams/:diagramId` route foundations.

The standalone Excalidraw workspace should remain unlinked from
public navigation. Do not attach a public `excalidraw.sketchi.app` product route
unless that product-route decision is explicitly reopened.
