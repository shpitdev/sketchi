---
"@sketchi/cli": minor
---

`sketchi generate` now draws brand logos inside flowchart nodes for the technologies a prompt names, such as GitHub, Docker, or Postgres. Logos are limited to the ones the prompt mentions, and everyday words such as "stream" or "segment" never count as a product name. Unknown slugs in `create` and `edit` point at https://icons.sketchi.app. `sketchi docs` explains how to add a node `icon` by hand.
