---
"@sketchi/cli": patch
---

A canvas now holds up to 5,000 elements instead of 600, so a large diagram, such as a 40-event timeline across five lanes, generates instead of failing. A generate request whose diagram still draws too much for one canvas answers `limit_exceeded` (HTTP 413) with the element count, instead of `render_failed` (HTTP 500).
