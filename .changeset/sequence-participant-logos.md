---
"@sketchi/cli": minor
---

Sequence diagrams now draw brand logos in participant headers. In `sketchi create`, a participant may set `"icon": { "slug": "github" }`. `sketchi generate` places logos only on participants whose labels name a technology the prompt mentions. The logos appear in PNG and Excalidraw exports, using the same catalog, offline resolution, and drop-with-a-warning rules as flowchart node logos.
