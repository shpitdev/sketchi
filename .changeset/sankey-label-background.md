---
"@sketchi/cli": patch
---

Sankey diagrams with a middle column now build a scene every CLI command can read. Their label backgrounds used to carry an empty label, which the scene contract rejects.
