---
"@sketchi/cli": patch
---

Transition and flowchart edge labels stay nearer their own line than any other. When another transition's run passes closer to a label than the label's own line, that run moves clear of it, but only where the move adds no crossings or reader findings. Text beside a vertical line now aligns toward that line, so it reads as attached to it. A return label no longer sits under a neighbouring cancellation run, as it did in the order lifecycle.
