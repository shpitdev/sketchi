---
"@sketchi/cli": patch
---

`sketchi generate --model` now reports a model the server does not support as a typed `unsupported_model` error that names the supported IDs and exits 3.
