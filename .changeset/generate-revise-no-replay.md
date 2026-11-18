---
"@sketchi/cli": patch
---

pr: #865

`sketchi generate` and `sketchi revise` now fail on HTTP 421 instead of silently resending a paid generation request.
