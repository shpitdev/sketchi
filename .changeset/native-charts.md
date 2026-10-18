---
"@sketchi/cli": minor
---

Add native bar, line and pie charts: `sketchi create` accepts `{"type":"chart"}` documents and `generate --type chart` builds them from a prompt. The renderer draws nice-tick axes, grouped or stacked bars that handle negative values, multi-series lines with distinct markers, and pies or donuts whose percentage labels move outside on leader lines for thin slices. Chart PNGs no longer get a second title banner.
