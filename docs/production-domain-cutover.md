# Production domains

The [domain policy](../tools/ops/src/deploy/production.ts) lists the hostnames each project may attach. This is not an inventory of live attachments.

| Project | Approved custom domains |
| --- | --- |
| `web` | `sketchi.app`, `www.sketchi.app` |
| `icons` | `icons.sketchi.app` |
| `studio` | `playground.sketchi.app` (Playground only; authenticated Studio is not exposed) |
| `editor` | None; internal canvas workspace |

## Attach or detach

After merge, dispatch [app-production-deploy](../.github/workflows/app-production-deploy.yml) on `main`. Select the intended `project` explicitly: the default is `all`. The workflow builds and deploys each selected Worker **before** its domain action.

- `none` (default): deploy without an explicit domain action.
- `attach`: requires an active `sketchi.app` Cloudflare zone. The workflow deploys a generated config with only the project's approved custom domains and keeps `workers_dev` enabled.
- `detach`: remove only approved hostnames attached to that project's Worker. If an approved hostname belongs to another service, the helper refuses to detach it.

Check that the requested action step ran. Without production Cloudflare credentials the workflow warns and skips both deployment and domain changes.
