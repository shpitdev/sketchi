---
"@sketchi/cli": patch
---

In a zoned flowchart, a line into a band hanging under its source no longer hooks around the region's margin to reach a step that another step of its rank stands in front of. It leaves forward and turns back into that step's far side, while the line to the nearer step drops straight down. A zone wrap that would cross only because of how the plain router drew its lines is routed again across as few lines as possible before it is judged, so sibling zones along a left-to-right flow stay side by side more often instead of stacking.
