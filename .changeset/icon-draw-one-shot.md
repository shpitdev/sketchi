---
"@sketchi/cli": patch
---

pr: #862

`sketchi icon draw` sends each paid draw request once. An HTTP 421 from the server can no longer make Node resend the request body and pay for a second draw; the command still retries only a refused-for-capacity 429 with a short `Retry-After`. Requests and responses follow the same contract Studio serves.
