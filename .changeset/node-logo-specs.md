---
"@sketchi/cli": minor
---

Flowchart specs accept an optional node `icon: { "slug": "docker" }` from the Sketchi logo catalog, resolved offline from logos bundled with the CLI. Unknown slugs, wordmarks, and oversized marks are dropped with an `unknown_icon` warning and never fail the build.
