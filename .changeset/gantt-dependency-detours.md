---
"@sketchi/cli": patch
---

Gantt dependency arrows no longer hook back where a straight route exists. An arrow passing a bar that ends just short of a milestone drops straight onto the diamond's edge. A second arrival that would loop around its successor shares the first arrival's last run into one arrowhead. An arrow forced around a bar clears it by half a bar height instead of tracing its edge, then runs back to its successor's start. A chart keeps these routes only when they cross no more often and read no worse than the earlier routing.
