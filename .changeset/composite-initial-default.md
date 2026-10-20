---
"@sketchi/cli": patch
---

A composite state with no initial entry now starts in its first listed regular substate. The build returns a non-blocking warning naming the composite and chosen substate; an explicit initial still takes precedence and invalid entries are rejected.
