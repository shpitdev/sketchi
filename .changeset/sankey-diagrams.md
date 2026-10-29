---
"@sketchi/cli": minor
---

Add native Sankey diagrams: `sketchi create` builds `{ "type": "sankey", "spec": { "title", "nodes", "links", "unit" } }` documents offline, and `sketchi generate --type sankey` generates them. Each node sits one column past the longest run of flows into it and draws as a bar as tall as the larger of its inflow and outflow, labeled with its name and total; each flow draws as a band as wide as its value in its source's color, with its value written beside or on it. A flow too thin to see draws at 3 px and keeps its exact value. Cycles, self-links, repeated flows and non-positive values are rejected with repair hints.
