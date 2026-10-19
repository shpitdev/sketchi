---
"@sketchi/cli": patch
---

Vendor logos follow the label: a cloud vendor's or platform's logo (`aws`, `cloudflare`, `kubernetes`, `gke`) stays on a flowchart node or sequence participant whose label names that vendor ("Cloudflare Workers", "AWS Lambda", "GKE cluster") and is dropped with an `icon_dropped` warning elsewhere ("Ingress controller", or "S3 bucket" with `aws`). A product's own logo is never touched.
