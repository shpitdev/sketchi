# Studio projects

`@sketchi/studio-projects` owns Studio project and diagram contracts, browser
API helpers, anonymous/authenticated ownership, and object-bucket persistence.

- `@sketchi/studio-projects/client` is safe for browser consumers.
- `@sketchi/studio-projects/server` exposes the persistence service and HTTP
  handlers behind narrow object-bucket and source-artifact contracts.

Cloudflare bindings and Code Mode artifact loading stay in the consuming app.
