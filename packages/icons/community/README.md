# @sketchi/community-icons

Hand-drawn icons anyone publishes, stored apart from the curated catalog.

- `handleCommunityPublish`, `handleCommunityList`, `handleCommunityDetail`
  and `handleCommunityVisibility` are the HTTP API the icons app routes to.
- `publishCommunityIcon(body)` checks a `{ name, recipe, verdict? }` request
  with the shared recipe checker, returns the icon already published with the
  same recipe hash, moderates the name and recipe text, and stores the rest.
- `CommunityIconStore` reads and writes one D1 table: slug, name, recipe,
  colors, recipe hash (unique, so a drawing publishes once), judge verdict,
  creation time, and a hidden flag the owner sets. The table is created on
  first use.
- `CommunityIconModeration` asks Jev, on Workers AI (`typesafe/jev`),
  whether a name or the recipe's words are unfit for a public gallery.
  Without an AI binding, nothing publishes.

D1 rather than R2: publishing needs a unique hash for dedupe and a unique
slug, and the gallery needs newest-first pages and name search, which one
indexed table answers without maintaining a separate index object.

Diagrams name a community icon as `community/<slug>`. The icons app owns
writes; Studio reads through `makeCommunityIconStore(...).getMany`.
