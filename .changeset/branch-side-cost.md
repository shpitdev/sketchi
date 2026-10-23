---
"@sketchi/cli": patch
---

Flowcharts render faster, and draw exactly as before. The router measured a branch label's size again on every route it tried; it now measures each label once. And where the crossing repair had moved a decision's branches, the branch-side choice laid out and completed the arrangement the diagram started from, which always drew the same layout again; it now skips it.
