# Studio projects

`@sketchi/studio-projects` owns Studio project and diagram contracts, browser
API helpers, anonymous/authenticated ownership, and object-bucket persistence.

- `@sketchi/studio-projects/client` is safe for browser consumers.
- `@sketchi/studio-projects/server` exposes Effect services and live/test
  layers for object storage, source artifacts, sessions, ownership, and Studio
  project workflows. Typed failures distinguish absence, corrupt data,
  authorization, session, source-artifact, and storage infrastructure errors.
- Persistence fan-out uses the provided `StudioPersistencePolicy` concurrency
  limit. The current Playground export is one thin Promise runtime edge over
  the Effect HTTP handlers until the app composition slice owns that wiring.

Cloudflare bindings and Code Mode artifact loading stay in the consuming app.
