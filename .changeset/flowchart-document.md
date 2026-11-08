---
"@sketchi/cli": minor
---

Flowcharts use the flowchart document: `nodes` maps an id to its label, `edges` are `[from, to, label?]` pairs (an end may list several ids), and groups and lanes list what they `contain`. Node roles come from the edges, so nodes no longer declare a `kind`, and `"logos": true` draws the logo of each product a node label names. Documents in the old node and edge arrays are no longer read.
