---
"@sketchi/cli": minor
---

Add native quadrant charts: `sketchi create` builds `{ "type": "quadrant", "spec": { "title", "xAxis", "yAxis", "quadrants", "points" } }` documents offline, and `sketchi generate --type quadrant` generates them. Each axis carries a title and its low and high end labels, the four quadrants are named by corner (`topLeft`, `topRight`, `bottomLeft`, `bottomRight`), and each point's `x` and `y` run from 0 to 1. The chart draws a square plot of four tinted quadrants, every dot at its exact position, and every label clear of the others, on a leader line where the plot is crowded.
