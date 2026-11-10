---
"@sketchi/cli": patch
---

A flowchart line no longer cuts through a step it leaves or enters. A line moved clear of a label or a nearby step could cross its own decision's tip, the side of a start or end ellipse, or its own box on the way to its arrowhead; each line now meets its steps only along the run that attaches to them, and curved lines keep clear of those shapes too.
