---
"@sketchi/cli": patch
---

pr: #865

`sketchi generate`, `sketchi revise` and `sketchi create` send their request once. An HTTP 421 from the server can no longer make Node silently resend a paid generation; the command now fails instead of paying twice.
