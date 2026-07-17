# Production domain cutover

The domain move is deliberately post-merge. Pull requests and ordinary pushes
deploy only to `workers.dev`; no workflow attaches a production custom domain
unless an operator explicitly dispatches `app-production-deploy` with
`domain_action=attach`.

## Adopted route map

| Host                           | Worker           | Policy                     |
| ------------------------------ | ---------------- | -------------------------- |
| `sketchi.app`                  | `sketchi-web`    | public                     |
| `www.sketchi.app`              | `sketchi-web`    | public                     |
| `playground.sketchi.app`       | `sketchi-studio` | public Playground boundary |
| `icons.sketchi.app`            | `sketchi-icons`  | public                     |
| authenticated Studio hostname  | none             | deferred                   |
| standalone Excalidraw hostname | none             | forbidden                  |

## Verified pre-cutover state

Snapshot from 2026-07-15:

- `sketchi.app` is registered and controlled through Vercel Domains. WHOIS
  reports Name.com, Inc. as the underlying registrar and an expiration date of
  2027-01-24, but operators must make nameserver changes in Vercel Domains, not
  at Name.com;
- authoritative nameservers: `ns1.vercel-dns.com` and
  `ns2.vercel-dns.com`;
- Cloudflare account `75f9660f39e4dafe8b95980b87e7399a` has no
  `sketchi.app` zone;
- Vercel DNS has exactly five records: apex `ALIAS`
  `34043a3f2790ef39.vercel-dns-016.com`, wildcard `ALIAS`
  `cname.vercel-dns-016.com.`, and apex `CAA` records for `pki.goog`,
  `sectigo.com`, and `letsencrypt.org`; there are no mail or TXT records;
- all five production Workers exist, every `workers.dev` root returns HTTP 200,
  and none has a custom domain or route;
- the obsolete Vercel Git integration is disconnected;
- the target GitHub `staging` and `production` environments each have a
  `CLOUDFLARE_ACCOUNT_ID` variable, but neither has the required
  `CLOUDFLARE_API_TOKEN` secret.

Do not infer that the Cloudflare zone is active merely because the Workers
exist. A nameserver migration in Vercel Domains is sufficient; transferring
the registration away from Vercel or the underlying registrar is unnecessary.

## Prerequisites

1. Merge the replacement pull request and verify `ci / required` plus the
   `app-production-deploy` run for the merge SHA.
2. Verify these stable rollback/proof URLs before changing DNS:
   `sketchi-web.dimethyl.workers.dev`,
   `sketchi-studio.dimethyl.workers.dev`, and
   `sketchi-icons.dimethyl.workers.dev`.
3. Add the missing `CLOUDFLARE_API_TOKEN` secret to both GitHub environments.
   Keep preview credentials in `staging` and production credentials in
   `production`; do not move either token to repository scope.
4. Pre-stage Cloudflare DNS equivalents of the five verified Vercel records.
   Vercel `ALIAS` records cannot be recreated literally in Cloudflare. Use
   these records instead:

   | Type    | Name | Content                               | Proxy      | Cutover role                                      |
   | ------- | ---- | ------------------------------------- | ---------- | ------------------------------------------------- |
   | `CNAME` | `@`  | `34043a3f2790ef39.vercel-dns-016.com` | DNS only   | apex fallback; Cloudflare flattens it at the apex |
   | `CNAME` | `*`  | `cname.vercel-dns-016.com.`           | DNS only   | fallback for subdomains                           |
   | `CAA`   | `@`  | `pki.goog`                            | DNS record | preserve the existing flag and tag                |
   | `CAA`   | `@`  | `sectigo.com`                         | DNS record | preserve the existing flag and tag                |
   | `CAA`   | `@`  | `letsencrypt.org`                     | DNS record | preserve the existing flag and tag                |

   Cloudflare applies CNAME flattening automatically to the apex DNS-only
   CNAME. Preserve all three CAA records exactly. Keep the wildcard CNAME
   during nameserver propagation and the app-by-app attach sequence.

## Cut over

1. Add `sketchi.app` to Cloudflare account
   `75f9660f39e4dafe8b95980b87e7399a` and record the assigned nameservers.
   Do not attach Worker domains yet.
2. Verify the two DNS-only CNAME equivalents and all three CAA records in the
   pending Cloudflare zone. There are currently no mail or TXT records to
   migrate.
3. In **Vercel Domains**, replace only the two authoritative Vercel nameservers
   with the two Cloudflare-assigned nameservers. Do not attempt this change at
   Name.com and do not transfer the registration.
4. Wait until both public DNS and the Cloudflare API report the new
   nameservers, and the Cloudflare zone reports exactly one result with
   `status=active`.
5. Attach the independent public hosts first. Run these project-specific workflow
   dispatches from the merged `main` branch:

   ```sh
   gh workflow run app-production-deploy.yml \
     --repo shpitdev/sketchi \
     --ref main \
     -f project=icons \
     -f domain_action=attach

   gh workflow run app-production-deploy.yml \
     --repo shpitdev/sketchi \
     --ref main \
     -f project=playground \
     -f domain_action=attach
   ```

   The `playground` project dispatch retains the `sketchi-studio` Worker and
   attaches only `playground.sketchi.app`; it does not
   expose `studio.sketchi.app`. Never dispatch attach for `eval-harness` or
   `excalidraw`. Verify `icons.sketchi.app` and `playground.sketchi.app` while
   the wildcard DNS-only CNAME remains staged. That wildcard is not a working
   fallback for these two hosts: Vercel currently returns
   `DEPLOYMENT_NOT_FOUND` for both of them.

6. Immediately before attaching Web, delete only the staged apex DNS-only
   CNAME (`@` -> `34043a3f2790ef39.vercel-dns-016.com`). A Workers Custom
   Domain cannot attach over an existing exact CNAME. Leave the wildcard CNAME
   and all three CAA records in place.
7. Attach the two Web hosts with a project-specific dispatch:

   ```sh
   gh workflow run app-production-deploy.yml \
     --repo shpitdev/sketchi \
     --ref main \
     -f project=web \
     -f domain_action=attach
   ```

   This attaches only `sketchi.app` and `www.sketchi.app`. The workflow refuses
   to attach unless the zone is active.

8. Verify all four approved hosts on desktop and mobile. Confirm HTTP success,
   the expected app identity, no console errors, no failed same-origin
   requests, and that `studio.sketchi.app` and `excalidraw.sketchi.app` are not
   exposed.
9. Remove the staged wildcard DNS-only CNAME only after all four approved hosts
   pass verification. Keep all three CAA records.

## Roll back

### Preferred application rollback: keep Cloudflare authoritative

An ordinary application rollback keeps the Cloudflare nameservers authoritative
and keeps `icons.sketchi.app` and `playground.sketchi.app` attached to their
Workers. Vercel currently binds only `sketchi.app` and `www.sketchi.app`; its
wildcard returns `DEPLOYMENT_NOT_FOUND` for the Icons and Playground hosts.

First restore the wildcard DNS-only CNAME if it was removed after verification;
it can coexist with the more-specific Worker Custom Domains. Then detach Web.
Workflow dispatch is asynchronous, so record the most recent matching run,
dispatch only Web, explicitly identify the new `production detach web` run,
and wait for it to succeed:

```sh
previous_web_detach_run_id="$(
  gh run list \
    --repo shpitdev/sketchi \
    --workflow app-production-deploy.yml \
    --branch main \
    --event workflow_dispatch \
    --limit 100 \
    --json databaseId,displayTitle \
    --jq '[.[] | select(.displayTitle == "production detach web") | .databaseId] | max // 0'
)"

gh workflow run app-production-deploy.yml \
  --repo shpitdev/sketchi \
  --ref main \
  -f project=web \
  -f domain_action=detach

while :; do
  web_detach_run_id="$(
    gh run list \
      --repo shpitdev/sketchi \
      --workflow app-production-deploy.yml \
      --branch main \
      --event workflow_dispatch \
      --limit 100 \
      --json databaseId,displayTitle \
      --jq '[.[] | select(.displayTitle == "production detach web") | .databaseId] | max // 0'
  )"
  if [ "$web_detach_run_id" -gt "$previous_web_detach_run_id" ]; then
    break
  fi
  sleep 2
done

gh run watch "$web_detach_run_id" \
  --repo shpitdev/sketchi \
  --exit-status
```

Do not dispatch another production Web detach concurrently. After the watched
run succeeds, query Cloudflare directly and require both Web Custom Domains to
be absent. The operator shell must have the production
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; do not print either value:

```sh
worker_domains_response="$(
  curl --fail-with-body --silent --show-error \
    --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/domains"
)"

WORKER_DOMAINS_RESPONSE="$worker_domains_response" node --input-type=module <<'NODE'
const payload = JSON.parse(process.env.WORKER_DOMAINS_RESPONSE ?? "{}");
if (payload.success !== true || !Array.isArray(payload.result)) {
  throw new Error("Unable to verify Cloudflare Worker Custom Domains.");
}

const webHosts = new Set(["sketchi.app", "www.sketchi.app"]);
const remaining = payload.result.filter((domain) => webHosts.has(domain.hostname));
if (remaining.length > 0) {
  throw new Error(
    `Web Custom Domains still attached: ${remaining.map(({ hostname }) => hostname).join(", ")}`,
  );
}

console.log("Web Worker Custom Domains are absent.");
NODE
```

Only after that check passes, restore the exact apex DNS-only CNAME
(`@` -> `34043a3f2790ef39.vercel-dns-016.com`) in Cloudflare. Verify the Vercel
application on `sketchi.app` and `www.sketchi.app`; keep the Cloudflare Worker
Custom Domains for Icons and Playground. The detach script lists Cloudflare
Worker domains, selects only the adopted hostnames for the expected Worker,
and fails closed on ownership drift before calling the Cloudflare detach API.
Local use is dry-run by default; `--apply` is required for mutation.

### Full nameserver rollback

Do not use a nameserver reversal as the ordinary application rollback. A full
rollback to `ns1.vercel-dns.com`/`ns2.vercel-dns.com` preserves service only for
the apex and `www`, because those are the only hosts bound to the Vercel
deployment. It intentionally makes `icons.sketchi.app` and
`playground.sketchi.app` unavailable unless a separate valid fallback is
provisioned first; the Vercel wildcard returning `DEPLOYMENT_NOT_FOUND` is not
a successful fallback check.

If that reduced route map is explicitly approved, first complete the watched
Web detach, absence check, apex CNAME restoration, and apex/`www` verification
above. Then dispatch project-specific detaches for `playground` and `icons`, identify
and wait for each corresponding workflow run, and change the authoritative
nameservers in **Vercel Domains** only after those runs succeed. The
`workers.dev` URLs remain available, but the public Icons and Playground hosts
do not. If those hosts must remain available, retain the Cloudflare nameservers
and their Worker Custom Domains instead.
