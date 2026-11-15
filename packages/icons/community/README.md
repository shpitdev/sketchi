# @sketchi/community-icons

Hand-drawn icons anyone publishes, stored apart from the curated catalog.

- `CommunityHttpHandlers` implements the shared `CommunityHttpApi` the icons
  app serves and its gallery and CLI consume.
- `publishCommunityIcon(body)` checks a `{ name, recipe, verdict? }` request
  with the shared recipe checker, returns the icon already published with the
  same recipe hash, moderates the name and recipe text, and stores the rest.
- `CommunityIconStore` reads and writes one D1 table: slug, name, recipe,
  colors, recipe hash (unique, so a drawing publishes once), judge verdict,
  creation time, and a hidden flag the owner sets. Its request-owned native
  D1 layer initializes the unchanged table and index in one fixed batch.
- `CommunityIconModeration` asks Jev, on Workers AI (`typesafe/jev`),
  whether a name or the recipe's words are unfit for a public gallery.
  Without an AI binding, new recipes cannot publish; visible stored hashes
  remain reusable without another moderation call.

D1 rather than R2: publishing needs a unique hash for dedupe and a unique
slug, and the gallery needs newest-first pages and name search, which one
indexed table answers without maintaining a separate index object.

Diagrams name a community icon as `community/<slug>`. The icons app owns
writes; Studio acquires `CommunityIconStore` through `communityIconStoreLayer`
and reads with `getMany` and `search`.

| Proof | Owner | Remote CI |
| --- | --- | --- |
| Unit and native D1 integration | Package Vitest suites, run by the local gate | No |
| e2e api | Manual proof against the built Icons Worker with isolated local D1 | No |
| e2e web | Manual proof through the local Icons page | No |

Remote CI typechecks affected projects; execution proof stays local.
