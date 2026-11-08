---
"@sketchi/cli": patch
---

A canvas now holds up to 5,000 elements instead of 600, so a diagram within its family's limits, such as a 40-event timeline across five lanes, no longer fails for drawing more than 600 elements. Each family keeps its own limits. A generate request whose diagram still draws too much for one canvas answers `limit_exceeded` (HTTP 413) with the element count, instead of `render_failed` (HTTP 500).
